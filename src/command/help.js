export default function help() {
  console.log(`
Usage: dh <command> [options]

Commands:
  dh config                        Configure user information
    --email=<email>
    --password=<password>
    --sessionid=<sessionid>        sessionid cookie (for Google login users)
    --csrf=<csrf_token>            csrf_token cookie (required alongside sessionid)
  dh create <wargame_link>         Download wargame
    -d --docker                    Build docker image and run container
    -c --continue                  Skip download/extract, reuse existing directory (preserves edits)
    -l --libc                      After build, copy libc.so.6 + ld-linux out of the image
  dh vm <wargame_link>             Manage hosted VM instance
    -c --create                    Create VM
    -g --get                       Get VM info (host/port)
    -d --delete                    Delete VM
  dh submit <wargame_link>         Submit flag
    --flag=<flag>
  dh help                          Display help for command
  `)
}
