#!/usr/bin/env python3
"""dh analyze helper. Reads <wargame_dir> and dumps JSON to stdout."""
import sys, os, json, re, subprocess, hashlib
from pathlib import Path


def find_binary(*search_dirs):
    for d in search_dirs:
        if not d.exists():
            continue
        for f in sorted(d.iterdir()):
            if not f.is_file():
                continue
            name = f.name.lower()
            if name.endswith(('.sh', '.xinetd', '.txt', '.md', '.json', '.yaml', '.yml')):
                continue
            if re.search(r'\.so($|\.\d)', name):
                continue
            if name.startswith(('libc-', 'libc.', 'ld-')):
                continue
            try:
                with f.open('rb') as fp:
                    if fp.read(4) == b'\x7fELF':
                        return f
            except Exception:
                pass
    return None


def find_libc(wargame_dir):
    cands = [
        wargame_dir / 'libc.so.6',
        wargame_dir / 'deploy' / 'libc.so.6',
    ]
    cands += sorted(wargame_dir.glob('libc-*.so'))
    cands += sorted((wargame_dir / 'deploy').glob('libc-*.so'))
    cands += sorted(wargame_dir.glob('*libc*.so*'))
    for c in cands:
        if c.exists() and c.is_file():
            return c
    return None


def get_buildid(elf_path):
    try:
        out = subprocess.check_output(['file', '-L', str(elf_path)], stderr=subprocess.DEVNULL).decode('latin-1')
        m = re.search(r'BuildID\[sha1\]=([0-9a-f]+)', out)
        return m.group(1) if m else None
    except Exception:
        return None


def detect_libc_version(libc_path):
    try:
        with open(libc_path, 'rb') as fp:
            data = fp.read()
    except Exception:
        return {}
    info = {}
    m = re.search(rb'GNU C Library[^\n]*?release version (\d+\.\d+)', data)
    if m:
        info['version'] = m.group(1).decode()
    m = re.search(rb'\b(\d+\.\d+-\d+ubuntu\d+(?:\.\d+)?)\b', data)
    if m:
        info['ubuntu'] = m.group(1).decode()
    m = re.search(rb'GLIBC_(\d+\.\d+)', data)
    if m and 'version' not in info:
        info['version'] = m.group(1).decode()
    return info


def collect_binary(elf_path):
    try:
        from pwn import ELF, ROP, context
        context.log_level = 'error'
    except ImportError:
        return {'error': 'pwntools not installed'}

    elf = ELF(str(elf_path), checksec=False)
    out = {
        'path': str(elf_path),
        'arch': elf.arch,
        'bits': elf.bits,
        'pie': bool(elf.pie),
        'nx': bool(elf.nx),
        'canary': bool(elf.canary),
        'relro': 'Full' if elf.relro == 'Full' else ('Partial' if elf.relro else 'No'),
        'symbols': {},
        'plt': {},
        'got': {},
        'gadgets': {},
    }

    interesting_syms = [
        'main', 'win', 'flag', 'getshell', 'shell', 'system', 'execve',
        'vuln', 'bof', 'overflow', 'gets', 'puts', 'printf', 'read', 'write',
        'fork', 'mprotect', 'open', '__libc_csu_init',
    ]
    for s in interesting_syms:
        try:
            if s in elf.symbols:
                out['symbols'][s] = int(elf.symbols[s])
        except Exception:
            pass

    plt_syms = ['system', 'execve', 'puts', 'printf', 'read', 'write', 'gets',
                'fopen', 'fread', 'fwrite', '__libc_start_main']
    for s in plt_syms:
        try:
            if s in elf.plt:
                out['plt'][s] = int(elf.plt[s])
            if s in elf.got:
                out['got'][s] = int(elf.got[s])
        except Exception:
            pass

    if elf.bits == 64:
        gadget_specs = [
            ('pop rdi; ret', ['pop rdi', 'ret']),
            ('pop rsi; ret', ['pop rsi', 'ret']),
            ('pop rdx; ret', ['pop rdx', 'ret']),
            ('pop rax; ret', ['pop rax', 'ret']),
            ('pop rsp; ret', ['pop rsp', 'ret']),
            ('syscall; ret', ['syscall', 'ret']),
            ('ret', ['ret']),
            ('leave; ret', ['leave', 'ret']),
        ]
    else:
        gadget_specs = [
            ('pop ebx; ret', ['pop ebx', 'ret']),
            ('pop eax; ret', ['pop eax', 'ret']),
            ('int 0x80; ret', ['int 0x80', 'ret']),
            ('ret', ['ret']),
        ]

    try:
        rop = ROP(elf)
        for name, insts in gadget_specs:
            try:
                g = rop.find_gadget(insts)
                if g:
                    out['gadgets'][name] = int(g.address)
            except Exception:
                pass
    except Exception as e:
        out['gadgets_error'] = str(e)

    bid = get_buildid(elf_path)
    if bid:
        out['buildid'] = bid

    return out


# Common leak sources → offset back to libc_base.
# These addresses are looked up per-libc; output as a quick-reference table.
LIBC_LEAK_CANDIDATES = [
    '_IO_2_1_stdout_', '_IO_2_1_stderr_', '_IO_2_1_stdin_',
    '__libc_start_main', 'puts', 'printf', 'system', 'read',
    'environ', '__environ', '_dl_runtime_resolve_xsavec',
    '__libc_csu_init',
]


def collect_libc(libc_path):
    try:
        from pwn import ELF, context
        context.log_level = 'error'
    except ImportError:
        return {'error': 'pwntools not installed'}

    out = {'path': str(libc_path), 'symbols': {}, 'strings': {}, 'leak_offsets': {}}

    info = detect_libc_version(libc_path)
    out.update(info)

    bid = get_buildid(libc_path)
    if bid:
        out['buildid'] = bid

    elf = ELF(str(libc_path), checksec=False)
    key_syms = ['system', 'execve', 'execvp', '__libc_start_main', '__libc_system',
                'setcontext', 'mprotect', 'environ', '__environ',
                '__free_hook', '__malloc_hook', '__realloc_hook',
                '_IO_2_1_stdout_', '_IO_2_1_stderr_', '_IO_2_1_stdin_',
                '_IO_wfile_jumps', '_IO_file_jumps', 'puts', 'printf', 'gets', 'read', 'write']
    for s in key_syms:
        try:
            if s in elf.symbols:
                out['symbols'][s] = int(elf.symbols[s])
        except Exception:
            pass

    for needle in [b'/bin/sh', b'/bin/bash', b'sh\x00']:
        try:
            addr = next(elf.search(needle))
            out['strings'][needle.decode('latin-1').replace('\x00', '\\x00')] = int(addr)
        except StopIteration:
            pass

    for s in LIBC_LEAK_CANDIDATES:
        try:
            if s in elf.symbols:
                out['leak_offsets'][s] = int(elf.symbols[s])
        except Exception:
            pass

    return out


def collect_one_gadget(libc_path):
    try:
        r = subprocess.run(['one_gadget', str(libc_path), '--raw'],
                           capture_output=True, text=True, timeout=15)
        if r.returncode == 0 and r.stdout.strip():
            return [int(x, 16) for x in r.stdout.strip().split()]
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return None


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'usage: analyze.py <wargame_dir>'}))
        sys.exit(1)

    wargame_dir = Path(sys.argv[1]).resolve()
    out = {'wargame_dir': str(wargame_dir)}

    deploy = wargame_dir / 'deploy'
    binary = find_binary(deploy, wargame_dir)
    if binary:
        out['binary'] = collect_binary(binary)
    else:
        out['binary_error'] = 'no ELF binary found in wargame dir or deploy/'

    libc = find_libc(wargame_dir)
    if libc:
        out['libc'] = collect_libc(libc)
        og = collect_one_gadget(libc)
        if og is not None:
            out['one_gadget'] = og

    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
