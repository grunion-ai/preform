// Argument parsing: `preform <cmd> [sub] [positionals] [--flags]`.
export const SUBCOMMANDS = { scene: ['new', 'get', 'rm', 'list'], op: ['get', 'list'] };

export function parse(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args.push(a); continue; }
    let [key, val] = a.slice(2).split(/=(.*)/s);
    if (val === undefined) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { val = next; i++; } else val = true;
    }
    if (key.startsWith('no-') && val === true) flags[key] = true;
    flags[key] = key in flags ? [].concat(flags[key], val) : val;
  }
  let cmd = args.shift() ?? 'help';
  if (SUBCOMMANDS[cmd]?.includes(args[0])) cmd = `${cmd} ${args.shift()}`;
  return { cmd, args, flags };
}

export function usage() {
  return `preform: Formlabs PreForm from the command line (Local API / PreFormServer)

Usage: preform <command> [args] [--url http://localhost:44388] [--json] [--no-wait]

Jobs
  prep <model...> --printer <type> --material <code> [--layer 0.1|ADAPTIVE] [--out job.form] [--no-support] [--keep]
  load <file.form>                          open a .form file as a new scene
  save <scene> <file.form>                  write the scene to a .form file
  screenshot <scene> <file.png>             render the scene to an image

Scenes
  scene new --printer <type> --material <code> [--layer ..] | --fps <file.fps>
  scene list | scene get <scene> | scene rm <scene>
  import <scene> <model> [--name ..]        add an STL/OBJ/3MF to the scene
  orient | support | layout <scene> [--models id,..] [--raft FULL_RAFT|MINI_RAFT|MINI_RAFTS_ON_BP]
  validate <scene>                          printability check per model
  estimate <scene>                          print time estimate

Printers
  devices | discover | device <id>
  materials [--printer <type>]              printer types, materials and settings
  print <scene> --printer <name|ip|serial> --name <job> [--now]

Operations
  op list | op get <id>

Raw
  api <METHOD> <path> [json]                any Local API call
  serve [--port 44388] [--server <path>]    run PreFormServer in the foreground

Environment: PREFORM_URL, PREFORM_SERVER (path to the PreFormServer binary).
When PREFORM_SERVER is found and nothing answers at --url, commands start a
server for the duration of the run.`;
}
