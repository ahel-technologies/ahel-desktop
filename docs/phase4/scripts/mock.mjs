// Mock OpenAI-compatible model on 127.0.0.1:4500: /models and a 400-chunk
// streamed completion per request (research note section 2 measurements).
import http from 'node:http';
const words = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ').split(' ');
http.createServer((req,res)=>{
  let body=''; req.on('data',c=>body+=c); req.on('end',async()=>{
    if(req.url.endsWith('/models')){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'mock-1'}]}));}
    res.writeHead(200,{'content-type':'text/event-stream'});
    const id='c'+Date.now();
    for(let i=0;i<400;i++){ // ~400 chunks
      res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',model:'mock-1',choices:[{index:0,delta:{content:words[i%words.length]+' '}}]})+'\n\n');
      if(i%20===0) await new Promise(r=>setTimeout(r,20));
    }
    res.write('data: '+JSON.stringify({id,object:'chat.completion.chunk',model:'mock-1',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1000,completion_tokens:400,total_tokens:1400}})+'\n\n');
    res.end('data: [DONE]\n\n');
  });
}).listen(4500,'127.0.0.1');
