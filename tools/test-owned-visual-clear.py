#!/usr/bin/env python3
"""Behavioral proof for native TUI /clear on a trusted owned runtime (Linux PTY)."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys
import time


_env_spec = importlib.util.spec_from_file_location(
    'owned_visual_clear_env', Path(__file__).with_name('owned-visual-clear-env.py'))
_env_module = importlib.util.module_from_spec(_env_spec)
_env_spec.loader.exec_module(_env_module)
SAFE_PARENT_ENV = _env_module.SAFE_PARENT_ENV
TUI_ENV_KEYS = _env_module.TUI_ENV_KEYS
FIXTURE_ENV_KEYS = _env_module.FIXTURE_ENV_KEYS
fixture_environment = _env_module.fixture_environment
assert_clean_child_environment = _env_module.assert_clean_child_environment


def preflight(binary, owned_root, manifest, env):
    import subprocess

    helper = Path(__file__).with_name('native-runtime-identity.mjs')
    script = r'''
import { readFile } from 'node:fs/promises';
const {loadNativeTestRuntime}=await import(process.argv[1]);
const expectedManifest=JSON.parse(await readFile(process.argv[4],'utf8'));
const identity=await loadNativeTestRuntime({binary:process.argv[2],ownedRoot:process.argv[3],expectedManifest,env:process.env});
process.stdout.write(JSON.stringify(identity));
'''
    result = subprocess.run(['node', '--input-type=module', '-e', script,
                             str(helper), str(Path(binary).resolve()),
                             str(Path(owned_root).resolve()), str(Path(manifest).resolve())],
                            capture_output=True, text=True, env=env)
    if result.returncode:
        raise RuntimeError(f'trusted owned-runtime preflight failed: {result.stderr.strip()}')
    return json.loads(result.stdout)


class Tui:
    active = set()

    def __init__(self, binary, fixture, session_id, env):
        import subprocess

        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 120, 0, 0))
        child_env = {**env, 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
                     'OPENCODE_PASSWORD': fixture['password']}
        assert_clean_child_environment(child_env)
        self.child = subprocess.Popen([binary, '--server', fixture['baseUrl'],
                                       '--session', session_id], cwd=fixture['cwd'],
                                      env=child_env, stdin=slave, stdout=slave,
                                      stderr=slave, start_new_session=True)
        os.close(slave)
        self.screen = Screen(rows=36, columns=120)
        self.active.add(self)

    def drain(self, seconds=.2):
        import subprocess

        end = time.monotonic() + seconds
        while time.monotonic() < end:
            ready, _, _ = select.select([self.master], [], [], .05)
            if ready:
                try:
                    data = os.read(self.master, 65536)
                except OSError:
                    return
                if not data:
                    return
                self.screen.feed(data)
            elif self.child.poll() is not None:
                raise AssertionError(f'TUI exited early: {self.child.returncode}')

    def wait_for(self, predicate, what, timeout=20):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.drain(.1)
            if predicate():
                self.drain(.2)
                return
        raise AssertionError(f'timed out waiting for {what}:\n{self.screen.visible()}')

    def submit(self, text):
        os.write(self.master, text.encode())
        os.write(self.master, b'\r')

    def submit_slash(self, text):
        os.write(self.master, text.encode())
        self.drain(.5)  # native slash autocomplete
        os.write(self.master, b'\r')  # select registered command
        self.drain(.3)
        os.write(self.master, b'\r')  # dispatch

    def stop(self):
        import subprocess

        if self not in self.active:
            return
        if self.child.poll() is None:
            os.killpg(self.child.pid, signal.SIGTERM)
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait(timeout=5)
        os.close(self.master)
        self.active.remove(self)


def main():
    # PTY and terminal semantics are POSIX-only; importing this runner is safe
    # on platforms that only execute its child-environment unit tests.
    global pty, fcntl, select, struct, termios, Screen
    import pty
    import fcntl
    import select
    import struct
    import termios
    import subprocess

    _spec = importlib.util.spec_from_file_location(
        'terminal_semantics', Path(__file__).with_name('native-terminal-semantics.py'))
    _module = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_module)
    Screen = _module.Screen

    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    parser.add_argument('--owned-root', required=True)
    parser.add_argument('--release-manifest', required=True)
    parser.add_argument('--artifact')
    args = parser.parse_args()

    binary = str(Path(args.binary).resolve())
    owned_root = str(Path(args.owned_root).resolve())
    root = Path(__file__).resolve().parents[1]
    work = Path(args.artifact).resolve().parent if args.artifact else Path('/tmp')
    resolver_env = fixture_environment(os.environ, work / 'ctg-visual-clear-runner',
                                       owned_root, Path(args.release_manifest).resolve())
    assert_clean_child_environment(resolver_env, FIXTURE_ENV_KEYS)
    # This test selects a local artifact and performs no download. No runtime
    # token is needed by preflight or any child, so the allowlist excludes it.
    if any(key.casefold() == 'ctg_runtime_github_token' for key in resolver_env):
        raise AssertionError('resolver environment retains a reserved runtime token')
    preflight_env = dict(resolver_env)
    print('Preflighting pinned executable...', file=sys.stderr, flush=True)
    identity = preflight(binary, owned_root, args.release_manifest, preflight_env)

    # Make the trusted resolver invocation and launch arguments explicit. The
    # fixture will repeat identity checks before its host process is started.
    fixture_script = r'''
const {nativeFixture}=await import((await import('node:url')).pathToFileURL(process.argv[1]));
const host=await nativeFixture({plugin:null,verifyInventory:false,preserveTemp:true,
 respond(_body,res){res.writeHead(200,{'content-type':'text/event-stream','connection':'close'});
 const chunk=(delta,finish_reason=null)=>`data: ${JSON.stringify({id:'offline-clear',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta,finish_reason}]})}\n\n`;
 res.end(chunk({role:'assistant',content:'CLEAR_FIXTURE_REPLY'})+chunk({},'stop')+'data: [DONE]\n\n');}});
try {
 const sessions={};
 for(const [key,marker] of [['a','CLEAR_SESSION_A_UNIQUE_MARKER'],['b','NEIGHBOR_SESSION_B_UNIQUE_MARKER'],['control','UNCLEARED_CONTROL_OLD_MARKER']]){
  const s=await host.client.session.create({location:host.location,model:host.model,title:`clear ${key}`},host.request());
  await host.client.session.prompt({sessionID:s.id,text:`Remember this visible marker: ${marker}`},host.request());
   await host.client.session.wait({sessionID:s.id},host.request()); sessions[key]={id:s.id,marker}; }
 await host.client.session.prompt({sessionID:sessions.control.id,text:'VISUAL_CLEAR_CONTINUED_PROMPT'},host.request());
 await host.client.session.wait({sessionID:sessions.control.id},host.request());
 process.stdout.write(JSON.stringify({baseUrl:host.baseUrl,password:host.password,temp:host.temp,cwd:host.cwd,sessions})+'\n');
 process.once('SIGTERM',async()=>{await host.close({preserveTemp:false});process.exit(0)});
 await new Promise(()=>{});
} catch(e){await host.close({preserveTemp:false});throw e}
'''
    child = subprocess.Popen(['node', '--input-type=module', '-e', fixture_script,
                               str(root / 'tools/native-fixture.mjs')], cwd=root,
                              env=resolver_env, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, text=True)
    tui = None
    try:
        line = child.stdout.readline()
        if not line:
            raise RuntimeError(f'fixture failed: {child.stderr.read()}')
        fixture = json.loads(line)
        bridge = r'''
import {OpenCode} from '@opencode/client';
const [url,password,id]=process.argv.slice(1);const c=OpenCode.make({baseUrl:url,headers:{authorization:`Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`}});
process.stdout.write(JSON.stringify(await c.message.list({sessionID:id},{signal:AbortSignal.timeout(10000)})));
'''
        def durable(session_id):
            return json.loads(subprocess.run(['node','--input-type=module','-e',bridge,
                fixture['baseUrl'],fixture['password'],session_id],cwd=root,check=True,
                capture_output=True,text=True,env=resolver_env).stdout)
        def conversation(value):
            return [x for x in value.get('data',[]) if x.get('type') in ('user','assistant','tool')]
        def stable(session_id):
            previous=durable(session_id); same=0; end=time.monotonic()+10
            while time.monotonic()<end:
                time.sleep(.25); current=durable(session_id)
                if current==previous:
                    same+=1
                    if same==2:return current
                else:previous=current;same=0
            raise AssertionError('durable message projection did not settle')

        def snapshot_conversation(session_id):
            return sorted(conversation(stable(session_id)),
                          key=lambda item: item.get('time', {}).get('created', 0))

        def wait_for_file_value(path, predicate, description, timeout=10):
            end = time.monotonic() + timeout
            while time.monotonic() < end:
                try:
                    value = json.loads(path.read_text())
                except (OSError, json.JSONDecodeError):
                    value = None
                if value is not None and predicate(value):
                    return value
                time.sleep(.05)
            raise AssertionError(f'timed out waiting for persisted {description}')

        a,b,control=(fixture['sessions'][key] for key in ('a','b','control'))
        before_b=conversation(stable(b['id']))
        before_control=conversation(stable(control['id']))
        if not any(x.get('text') == 'Remember this visible marker: UNCLEARED_CONTROL_OLD_MARKER'
                   for x in before_control if x.get('type') == 'user') or not any(
                   x.get('text') == 'VISUAL_CLEAR_CONTINUED_PROMPT'
                   for x in before_control if x.get('type') == 'user'):
            raise AssertionError('positive-control transcript was not seeded with both user turns')
        profile_script="import {runtimeEnvironment} from './lib/opencode/runtime.mjs';process.stdout.write(JSON.stringify(runtimeEnvironment({root:process.argv[1],env:process.env})))"
        env=json.loads(subprocess.run(['node','--input-type=module','-e',profile_script,fixture['temp']],
            cwd=root,env=resolver_env,check=True,capture_output=True,text=True).stdout)
        env={key:value for key,value in env.items() if key in TUI_ENV_KEYS}
        env.update({key:value for key,value in resolver_env.items() if key in SAFE_PARENT_ENV})
        env['OPENCODE_PASSWORD']=fixture['password']
        assert_clean_child_environment(env)

        for key, value in env.items():
            if key.casefold() in ('opencode_password', 'opencode_server_password'):
                continue
            if value in (fixture['password'], fixture['baseUrl']):
                raise AssertionError(f'synthetic fixture credential unexpectedly occupies allowlisted variable {key}')
        env['OPENCODE_SERVER_PASSWORD'] = fixture['password']
        env['OPENCODE_SERVER_USERNAME'] = 'opencode'
        assert_clean_child_environment(env)

        tui=Tui(binary,fixture,a['id'],env)
        tui.wait_for(lambda:a['marker'] in tui.screen.visible(),'A marker')
        tui.wait_for(lambda:'CLEAR_FIXTURE_REPLY' in tui.screen.visible(),'A assistant reply')
        before_a=snapshot_conversation(a['id'])
        cutoff_message = max(before_a, key=lambda item: item.get('time', {}).get('created', 0))
        tui.submit_slash('/clear')
        tui.wait_for(lambda:a['marker'] not in tui.screen.visible() and 'CLEAR_FIXTURE_REPLY' not in tui.screen.visible(),'/clear visual removal')
        if sorted(conversation(durable(a['id'])), key=lambda item:item.get('time',{}).get('created',0))!=before_a:
            raise AssertionError('/clear changed durable conversational messages')
        storage_matches = list((Path(fixture['temp']) / 'state').rglob('transcript-presentation.json'))
        if len(storage_matches) != 1:
            raise AssertionError(f'expected one isolated transcript-presentation store, found {len(storage_matches)}')
        storage_path = storage_matches[0]
        state_after_clear = wait_for_file_value(storage_path,
            lambda state: state.get(a['id'], {}).get('before') == cutoff_message['id'],
            'A transcript cutoff')
        tui.submit('VISUAL_CLEAR_CONTINUED_PROMPT')
        tui.wait_for(lambda:'CLEAR_FIXTURE_REPLY' in tui.screen.visible(),'follow-up reply')
        after_followup=snapshot_conversation(a['id'])
        if len(after_followup)<=len(before_a) or not any(x.get('type')=='user' and x.get('text')=='VISUAL_CLEAR_CONTINUED_PROMPT' for x in after_followup):
            raise AssertionError('follow-up prompt was not durably submitted')
        state_after_followup = wait_for_file_value(storage_path,
            lambda state: state.get(a['id'], {}).get('before') == cutoff_message['id'],
            'cutoff unchanged after follow-up')
        if state_after_followup.get(a['id'], {}).get('before') != cutoff_message['id']:
            raise AssertionError('follow-up turn changed the persisted transcript cutoff')
        tui.stop();tui=None

        neighbor=Tui(binary,fixture,b['id'],env)
        neighbor.wait_for(lambda:b['marker'] in neighbor.screen.visible(),'B marker')
        if a['marker'] in neighbor.screen.visible() or conversation(durable(b['id']))!=before_b:
            raise AssertionError('neighbor session B was affected by clearing A')
        neighbor.stop()

        # Positive control: same short two-turn transcript, no clear command.
        # At the same terminal dimensions and initial tail position, both old
        # and new markers must remain visible without the presentation cutoff.
        control_tui=Tui(binary,fixture,control['id'],env)
        control_tui.wait_for(lambda:control['marker'] in control_tui.screen.visible(),
                             'uncleared positive-control initial marker')
        control_tui.wait_for(lambda:'VISUAL_CLEAR_CONTINUED_PROMPT' in control_tui.screen.visible(),
                             'uncleared positive-control follow-up marker')
        if 'CLEAR_FIXTURE_REPLY' not in control_tui.screen.visible():
            raise AssertionError('uncleared control transcript did not fit the viewport')
        control_visible = control_tui.screen.visible()
        if control['marker'] not in control_visible:
            raise AssertionError('uncleared control old marker is not visible at initial PTY position')
        control_tui.stop()

        reopened=Tui(binary,fixture,a['id'],env)
        reopened.wait_for(lambda:'VISUAL_CLEAR_CONTINUED_PROMPT' in reopened.screen.visible(),
                          'post-clear marker visible after reopening A')
        reopened_visible = reopened.screen.visible()
        if a['marker'] in reopened_visible:
            raise AssertionError('old A marker remains visible; transcript presentation cutoff was not restored')
        if 'CLEAR_FIXTURE_REPLY' not in reopened_visible:
            raise AssertionError('post-clear assistant reply is not visible after reopening A')
        if control['marker'] not in control_visible or 'VISUAL_CLEAR_CONTINUED_PROMPT' not in control_visible:
            raise AssertionError('positive control did not show old and post-turn content at tested PTY position')
        if conversation(durable(a['id']))!=after_followup:
            raise AssertionError('durable A conversation changed on reopening')
        reopened_state = wait_for_file_value(storage_path,
            lambda state: state.get(a['id'], {}).get('before') == cutoff_message['id'],
            'cutoff restored on reopen')
        if reopened_state.get(a['id'], {}).get('before') != cutoff_message['id']:
            raise AssertionError('reopened TUI lost the persisted presentation cutoff')
        reopened.stop()
        tui=None
        result={'status':'PASS','scope':'Linux POSIX PTY; explicit trusted-preflighted owned staging artifact; offline loopback provider',
          'runtimeIdentity':identity,'sessionIDs':{'a':a['id'],'b':b['id']},
          'command':'native slash autocomplete selected /clear; Enter dispatched it',
          'checks':{'A markers disappeared from parsed PTY screen':True,'A conversational message IDs/content unchanged by clear':True,
           'follow-up prompt submitted and answered':True,'neighbor B unaffected':True,
           'A old marker hidden while post-clear markers visible on reopen':True,
           'uncleared same-length positive control shows old and new markers at same PTY size':True,
           'presentation cutoff ID persisted and unchanged across follow-up/reopen':True,
           'session.revert.clear used':False,
           'ambient credentials excluded by child environment allowlists':True},
          'binarySha256':identity['binarySha256'],'cutoffMessageID':cutoff_message['id'],
          'messagesBeforeClear':len(before_a),'messagesAfterFollowup':len(after_followup)}
        rendered=json.dumps(result,indent=2)+'\n';print(rendered,end='')
        if args.artifact:Path(args.artifact).write_text(rendered)
    finally:
        for running_tui in list(Tui.active):
            running_tui.stop()
        child.terminate()
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill();child.wait()


if __name__=='__main__':
    main()
