import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createManualProjects(
  destination,
  { packages = 128 } = {},
) {
  if (!Number.isInteger(packages) || packages < 2 || packages > 1024)
    throw Error('packages must be an integer from 2 to 1024');
  const root = resolve(destination);
  await mkdir(dirname(root), { recursive: true });
  await mkdir(root);
  const write = async (project, file, contents) => {
    const path = join(root, project, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  };
  const packageFile = (name, extra = {}) =>
    JSON.stringify(
      {
        name,
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: {
          test: 'node --test test/*.test.mjs',
          'test:acceptance': 'node --test acceptance/*.test.mjs',
          ...extra,
        },
      },
      null,
      2,
    ) + '\n';
  const imports =
    "import {test} from 'node:test';\nimport assert from 'node:assert/strict';\n";
  try {
    await write('tiny', 'package.json', packageFile('ctg-invoice-fixture'));
    await write(
      'tiny',
      'src/invoice.mjs',
      'export function invoiceTotal(lines) { return lines.reduce((total, line) => total + line.quantity * line.unitPrice, 0); }\n',
    );
    await write(
      'tiny',
      'test/invoice.test.mjs',
      imports +
        "import {invoiceTotal} from '../src/invoice.mjs';\ntest('empty invoices',()=>assert.equal(invoiceTotal([]),0));\ntest('integer totals',()=>assert.equal(invoiceTotal([{quantity:2,unitPrice:500}]),1000));\n",
    );
    await write(
      'tiny',
      'acceptance/discount.test.mjs',
      imports +
        "import {invoiceTotal} from '../src/invoice.mjs';\ntest('discount in basis points, rounded once to cents',()=>assert.equal(invoiceTotal([{quantity:3,unitPrice:199}],{discountBps:1500}),507));\ntest('reject invalid discounts',()=>assert.throws(()=>invoiceTotal([],{discountBps:10001}),RangeError));\ntest('immutable inputs',()=>assert.equal(invoiceTotal(Object.freeze([Object.freeze({quantity:1,unitPrice:999})]),{discountBps:1000}),899));\n",
    );
    await write(
      'tiny',
      'TASK.md',
      '# Small task\nAdd optional {discountBps} to invoiceTotal. Prices/totals are integer cents. Accept integer discounts 0..10000; reject others with RangeError. Round once after discount. Preserve old calls and never mutate inputs. Run npm test and npm run test:acceptance. Baseline is green; new-feature acceptance is intentionally red.\n',
    );

    await write(
      'product',
      'package.json',
      packageFile('ctg-forgeboard-fixture', { start: 'node server.mjs' }),
    );
    await write(
      'product',
      'src/issues.mjs',
      "export const initialIssues=()=>[{id:1,title:'Design onboarding',status:'todo',revision:1},{id:2,title:'Fix keyboard navigation',status:'doing',revision:1}];\nexport const selectIssues=(issues,status)=>issues.filter(issue=>!status||issue.status===status);\n",
    );
    await write(
      'product',
      'server.mjs',
      `import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {initialIssues,selectIssues} from './src/issues.mjs';
export function createApp(){
 const issues=initialIssues();
 return createServer(async(request,response)=>{
  const url=new URL(request.url,'http://localhost');
  if(request.method==='GET'&&url.pathname==='/api/issues'){response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(selectIssues(issues,url.searchParams.get('status'))));return;}
  if(request.method==='GET'&&url.pathname==='/'){response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(await readFile(new URL('./public/index.html',import.meta.url)));return;}
  response.writeHead(404,{'content-type':'application/json'});response.end(JSON.stringify({error:'not found'}));
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const server=createApp();server.listen(Number(process.env.PORT??3017),'127.0.0.1',()=>console.log('Forgeboard: http://127.0.0.1:'+server.address().port));}
`,
    );
    await write(
      'product',
      'public/index.html',
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Forgeboard</title><style>body{font:18px system-ui;background:#f4f1e9;color:#202923;max-width:900px;margin:64px auto;padding:24px}header{border-bottom:2px solid #202923}li{background:white;padding:20px;margin:12px 0;list-style:none}select{font:inherit;padding:8px}</style><header><small>CARTHAGENT TEST PROJECT / 02</small><h1>Forgeboard</h1><p>A disposable issue board. No external services.</p></header><p><label>Status <select id="status"><option value="">All</option><option>todo</option><option>doing</option><option>done</option></select></label></p><ul id="issues"></ul><script type="module">async function load(){const issues=await(await fetch("/api/issues?status="+encodeURIComponent(document.querySelector("select").value))).json();document.querySelector("ul").replaceChildren(...issues.map(issue=>{const li=document.createElement("li");li.textContent=issue.title+" · "+issue.status+" · revision "+issue.revision;return li}));}document.querySelector("select").onchange=load;load();</script></html>\n',
    );
    const apiTest =
      "import {createApp} from '../server.mjs';\nasync function appFor(t){const app=createApp();await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.close(r)));return 'http://127.0.0.1:'+app.address().port;}\n";
    await write(
      'product',
      'test/api.test.mjs',
      imports +
        apiTest +
        "test('real HTTP list, filtering, UI and 404',async t=>{const base=await appFor(t);assert.equal((await(await fetch(base+'/api/issues')).json()).length,2);assert.equal((await(await fetch(base+'/api/issues?status=doing')).json())[0].id,2);assert.match(await(await fetch(base)).text(),/Forgeboard/);assert.equal((await fetch(base+'/missing')).status,404);});\n",
    );
    await write(
      'product',
      'acceptance/update.test.mjs',
      imports +
        apiTest +
        "test('optimistic concurrency protects competing status updates',async t=>{const base=await appFor(t);const patch=(revision,status)=>fetch(base+'/api/issues/1',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({revision,status})});const first=await patch(1,'done');assert.equal(first.status,200);assert.equal((await first.json()).revision,2);assert.equal((await patch(1,'doing')).status,409);assert.equal((await patch(2,'invalid')).status,400);const list=await(await fetch(base+'/api/issues?status=done')).json();assert.equal(list[0].id,1);assert.equal(list[0].status,'done');});\n",
    );
    await write(
      'product',
      'TASK.md',
      '# Product task\nImplement PATCH /api/issues/:id accepting JSON {status,revision}. Allow todo/doing/done. Stale revisions ->409; invalid input/JSON ->400; unknown ids ->404; oversized bodies ->413. Increment revision exactly once on success. Add accessible status controls and error feedback to the board. Keep in-memory storage; no external services/dependencies. Preserve safe text rendering. Add malformed/oversized/unknown-id tests beyond supplied acceptance. Run npm test and npm run test:acceptance. Start npm start and inspect http://127.0.0.1:3017 manually.\n',
    );

    await write(
      'scale',
      'package.json',
      packageFile('ctg-scale-monorepo', {
        'test:stress': 'node --test --test-concurrency=2 test/*.test.mjs',
      }),
    );
    await write(
      'scale',
      'shared/money.mjs',
      'export function roundMoney(value){return Math.round(value*100)/100;}\n',
    );
    await write(
      'scale',
      'test/packages.test.mjs',
      imports +
        Array.from(
          { length: packages },
          (_, i) =>
            `test('domain-${i} integration',async()=>{const {total}=await import('../packages/domain-${i}/src/index.mjs');assert.equal(total([1,2,3]),6);assert.equal(total([]),0);});`,
        ).join('\n') +
        '\n',
    );
    for (let i = 0; i < packages; i++) {
      await write(
        'scale',
        `packages/domain-${i}/package.json`,
        JSON.stringify({
          name: `@fixture/domain-${i}`,
          private: true,
          type: 'module',
        }) + '\n',
      );
      await write(
        'scale',
        `packages/domain-${i}/src/index.mjs`,
        "import {roundMoney} from '../../../shared/money.mjs';\nexport const total=values=>roundMoney(values.reduce((sum,value)=>sum+value,0));\n",
      );
      for (let j = 0; j < 8; j++)
        await write(
          'scale',
          `packages/domain-${i}/src/metric-${j}.mjs`,
          `import {total} from './index.mjs';\nexport const metric${j}=values=>({domain:${i},metric:${j},total:total(values)});\n`,
        );
      await write(
        'scale',
        `docs/domain-${i}.md`,
        `# Domain ${i}\nUses shared/money.mjs through its public index. Preserve domain identity.\n`,
      );
    }
    await write(
      'scale',
      'acceptance/rounding.test.mjs',
      imports +
        "import {roundMoney} from '../shared/money.mjs';\nimport {total} from '../packages/domain-0/src/index.mjs';\ntest('decimal halves away from zero across shared consumers',()=>{assert.equal(roundMoney(1.005),1.01);assert.equal(roundMoney(-1.005),-1.01);assert.equal(total([1.005]),1.01);});\ntest('reject nonfinite amounts',()=>{for(const v of [NaN,Infinity,-Infinity])assert.throws(()=>roundMoney(v),RangeError);});\n",
    );
    await write(
      'scale',
      'TASK.md',
      `# Large monorepo task\n${packages} packages share money rounding; do not rewrite generated packages. Fix representable decimal halves (1.005 ->1.01, -1.005 ->-1.01, ties away from zero); reject nonfinite numbers with RangeError. Preserve existing behavior, avoid dependencies, and add boundary regressions. Run npm test and npm run test:acceptance. Use code navigation to find affected consumers and verify at least three distinct domains.\n`,
    );
    const inventory = {};
    for (const name of ['tiny', 'product', 'scale']) {
      await write(name, '.gitignore', 'node_modules/\n.harness/\n.env\n');
      const files = [];
      const visit = async (directory) => {
        for (const entry of (
          await readdir(join(root, name, directory), { withFileTypes: true })
        ).sort((a, b) => a.name.localeCompare(b.name))) {
          const file = directory ? `${directory}/${entry.name}` : entry.name;
          if (entry.isDirectory()) await visit(file);
          else
            files.push({
              path: file,
              sha256: createHash('sha256')
                .update(await readFile(join(root, name, file)))
                .digest('hex'),
            });
        }
      };
      await visit('');
      inventory[name] = { files: files.length, source: files };
      const git = (...args) =>
        execFileSync('git', ['-c', 'core.hooksPath=disabled-hooks', ...args], {
          cwd: join(root, name),
          stdio: 'pipe',
        });
      git('init', '-b', 'main');
      git('add', '.');
      git(
        '-c',
        'user.name=CTG manual fixture',
        '-c',
        'user.email=fixture@localhost',
        'commit',
        '-m',
        'Initialize disposable manual-test project\n\nCo-authored-by: openhands <openhands@all-hands.dev>',
      );
    }
    await writeFile(
      join(root, 'inventory.json'),
      JSON.stringify({ version: 1, packages, projects: inventory }, null, 2) +
        '\n',
    );
    return {
      root,
      packages,
      projects: Object.fromEntries(
        Object.entries(inventory).map(([name, value]) => [
          name,
          { files: value.files },
        ]),
      ),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [destination, packages] = process.argv.slice(2);
  if (!destination)
    throw Error(
      'Usage: node tools/native-manual-projects.mjs <new-directory> [packages=128]',
    );
  console.log(
    JSON.stringify(
      await createManualProjects(destination, {
        packages: Number(packages ?? 128),
      }),
      null,
      2,
    ),
  );
}
