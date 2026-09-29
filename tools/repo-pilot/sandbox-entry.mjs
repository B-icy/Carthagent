import http from 'node:http';
import { spawn } from 'node:child_process';
const server = http.createServer((req,res) => {
  const upstream = http.request({socketPath:'/broker.sock',method:req.method,path:req.url,headers:{'content-type':'application/json'}}, response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
  res.on('close',()=>upstream.destroy());req.pipe(upstream);
});
server.listen(12345,'127.0.0.1',()=>{
 const child=spawn(process.execPath,process.argv.slice(2),{stdio:'inherit',env:process.env});
 child.on('exit',(code)=>{server.closeAllConnections();server.close(()=>process.exit(code??1));});
 process.on('SIGTERM',()=>{child.kill();server.closeAllConnections();server.close();});
});
