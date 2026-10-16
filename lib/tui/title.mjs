import { basename } from 'node:path';

export function terminalTitleSequence(cwd) {
  // Folder names must not inject terminal controls into the OSC title.
  const folder = basename(cwd).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
  return `\x1b]0;Carthagent${folder ? ` - ${folder}` : ''}\x07`;
}
