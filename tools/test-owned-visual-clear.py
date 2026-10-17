#!/usr/bin/env python3
"""Behavioral proof for native TUI /clear on a trusted owned runtime (Linux PTY)."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import pty
import fcntl
import select
import signal
import struct
import subprocess
import sys
import termios
import time

_spec = importlib.util.spec_from_file_location(
    'terminal_semantics', Path(__file__).with_name('native-terminal-semantics.py'))
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
Screen = _module.Screen


def preflight(binary, owned_root, manifest):
    helper = Path(__file__).with_name('native-runtime-identity.mjs')
    script = r'''
import { readFile } from 'node:fs/promises';
const {loadNativeTestRuntime}=await import(process.argv[1]);
const expectedManifest=JSON.parse(await readFile(process.argv[4],'utf8'));
const identity=await loadNativeTestRuntime({binary:process.argv[2],ownedRoot:process.argv[3],expectedManifest});
process.stdout.write(JSON.stringify(identity));
'''
    result = subprocess.run(['node', '--input-type=module', '-e', script,
                             str(helper), str(Path(binary).resolve()),
                             str(Path(owned_root).resolve()), str(Path(manifest).resolve())],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f'trusted owned-runtime preflight failed: {result.stderr.strip()}')
    return json.loads(result.stdout)


class Tui:
    def __init__(self, binary, fixture, session_id, env):
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 120, 0, 0))
        child_env = {**env, 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
                     'OPENCODE_PASSWORD': fixture['password']}
        self.child = subprocess.Popen([binary, '--server', fixture['baseUrl'],
                                       '--session', session_id], cwd=fixture['cwd'],
                                      env=child_env, stdin=slave, stdout=slave,
                                      stderr=slave, start_new_session=True)
        os.close(slave)
        self.screen = Screen(rows=36, columns=120)

    def drain(self, seconds=.2):
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
        if self.child.poll() is None:
            os.killpg(self.child.pid, signal.SIGTERM)
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait(timeout=5)
        os.close(self.master)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    parser.add_argument('--owned-root', required=True)
    parser.add_argument('--release-manifest', required=True)
    parser.add_argument('--artifact')
    args = parser.parse_args()

    # Exercise case-insensitive removal using fake values only. Never read or
    # print an actual runtime download token.
    for key in ('CTG_RUNTIME_GITHUB_TOKEN', 'ctg_runtime_github_token',
                'Ctg_Runtime_Github_Token'):
        os.environ[key] = 'FAKE_TEST_TOKEN_DO_NOT_USE'
    for key in list(os.environ):
        if key.casefold() == 'ctg_runtime_github_token':
            del os.environ[key]
    if any(key.casefold() == 'ctg_runtime_github_token' for key in os.environ):
        raise AssertionError('reserved download token survived environment sanitization')

    binary = str(Path(args.binary).resolve())
    owned_root = str(Path(args.owned_root).resolve())
    print('Preflighting pinned executable...', file=sys.stderr, flush=True)
    identity = preflight(binary, owned_root, args.release_manifest)
    root = Path(__file__).resolve().parents[1]
    os.environ['CTG_OWNED_OPENCODE_RUNTIME'] = owned_root
    os.environ['CTG_TEST_RUNTIME_RELEASE_MANIFEST'] = str(Path(args.release_manifest).resolve())
    os.environ.pop('CTG_OPENCODE_BIN', None)

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
 for(const [key,marker] of [['a','CLEAR_SESSION_A_UNIQUE_MARKER'],['b','NEIGHBOR_SESSION_B_UNIQUE_MARKER']]){
  const s=await host.client.session.create({location:host.location,model:host.model,title:`clear ${key}`},host.request());
  await host.client.session.prompt({sessionID:s.id,text:`Remember this visible marker: ${marker}`},host.request());
  await host.client.session.wait({sessionID:s.id},host.request()); sessions[key]={id:s.id,marker}; }
 process.stdout.write(JSON.stringify({baseUrl:host.baseUrl,password:host.password,temp:host.temp,cwd:host.cwd,sessions})+'\n');
 process.once('SIGTERM',async()=>{await host.close({preserveTemp:false});process.exit(0)});
 await new Promise(()=>{});
} catch(e){await host.close({preserveTemp:false});throw e}
'''
    child = subprocess.Popen(['node', '--input-type=module', '-e', fixture_script,
                               str(root / 'tools/native-fixture.mjs')], cwd=root,
                              env=os.environ.copy(), stdout=subprocess.PIPE,
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
                capture_output=True,text=True).stdout)
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

        a,b=fixture['sessions']['a'],fixture['sessions']['b']
        before_b=conversation(stable(b['id']))
        profile_script="import {runtimeEnvironment} from './lib/opencode/runtime.mjs';process.stdout.write(JSON.stringify(runtimeEnvironment({root:process.argv[1],env:process.env})))"
        env=json.loads(subprocess.run(['node','--input-type=module','-e',profile_script,fixture['temp']],
            cwd=root,env=os.environ.copy(),check=True,capture_output=True,text=True).stdout)
        env.update({k:v for k,v in os.environ.items() if k in ('PATH','LANG','LC_ALL')})
        env['OPENCODE_PASSWORD']=fixture['password']
        if any(k.casefold()=='ctg_runtime_github_token' for k in env):
            raise AssertionError('runtimeEnvironment leaked reserved download token')

        tui=Tui(binary,fixture,a['id'],env)
        tui.wait_for(lambda:a['marker'] in tui.screen.visible(),'A marker')
        tui.wait_for(lambda:'CLEAR_FIXTURE_REPLY' in tui.screen.visible(),'A assistant reply')
        before_a=conversation(stable(a['id']))
        tui.submit_slash('/clear')
        tui.wait_for(lambda:a['marker'] not in tui.screen.visible() and 'CLEAR_FIXTURE_REPLY' not in tui.screen.visible(),'/clear visual removal')
        if conversation(durable(a['id']))!=before_a:
            raise AssertionError('/clear changed durable conversational messages')
        tui.submit('VISUAL_CLEAR_CONTINUED_PROMPT')
        tui.wait_for(lambda:'CLEAR_FIXTURE_REPLY' in tui.screen.visible(),'follow-up reply')
        after_followup=conversation(stable(a['id']))
        if len(after_followup)<=len(before_a) or not any(x.get('type')=='user' and x.get('text')=='VISUAL_CLEAR_CONTINUED_PROMPT' for x in after_followup):
            raise AssertionError('follow-up prompt was not durably submitted')
        tui.stop();tui=None

        neighbor=Tui(binary,fixture,b['id'],env)
        neighbor.wait_for(lambda:b['marker'] in neighbor.screen.visible(),'B marker')
        if a['marker'] in neighbor.screen.visible() or conversation(durable(b['id']))!=before_b:
            raise AssertionError('neighbor session B was affected by clearing A')
        neighbor.stop()

        reopened=Tui(binary,fixture,a['id'],env)
        reopened.wait_for(lambda:a['marker'] not in reopened.screen.visible() and 'CLEAR_FIXTURE_REPLY' in reopened.screen.visible(),'A cutoff restored on reopen')
        if conversation(durable(a['id']))!=after_followup:
            raise AssertionError('durable A conversation changed on reopening')
        reopened.stop()
        tui=None
        result={'status':'PASS','scope':'Linux POSIX PTY; explicit trusted-preflighted owned staging artifact; offline loopback provider',
          'runtimeIdentity':identity,'sessionIDs':{'a':a['id'],'b':b['id']},
          'command':'native slash autocomplete selected /clear; Enter dispatched it',
          'checks':{'A markers disappeared from parsed PTY screen':True,'A conversational message IDs/content unchanged by clear':True,
           'follow-up prompt submitted and answered':True,'neighbor B unaffected':True,
           'A visual cutoff restored on reopen':True,'session.revert.clear used':False,
           'fake token variants removed before child spawn':True},
          'binarySha256':identity['binarySha256'],'messagesBeforeClear':len(before_a),'messagesAfterFollowup':len(after_followup)}
        rendered=json.dumps(result,indent=2)+'\n';print(rendered,end='')
        if args.artifact:Path(args.artifact).write_text(rendered)
    finally:
        if tui:tui.stop()
        child.terminate()
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill();child.wait()


if __name__=='__main__':
    main()
