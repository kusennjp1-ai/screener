"""Identical gzip HTTP conditions for old/new compiled-app browser checks."""
import argparse
import gzip
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('root');parser.add_argument('--port',type=int,default=5180);parser.add_argument('--extra-ports',type=int,nargs='*',default=[])
parser.add_argument('--measure',action='store_true')
args=parser.parse_args();root=Path(args.root).resolve();probe=Path(__file__).with_name('audit-performance.js').read_bytes()

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path=self.path.split('?')[0].removeprefix('/screener/').lstrip('/') or 'index.html'
        target=(root/path).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            self.send_error(404);return
        body=target.read_bytes()
        if path=='index.html':body=body.replace(b'<head>',b'<head><script>'+probe+b'</script>')
        compressed=gzip.compress(body)
        if args.measure and path.startswith('static-data/'):
            print(json.dumps({'port':self.server.server_port,'path':path,'encoded':len(compressed),'decoded':len(body)}),flush=True)
        self.send_response(200);self.send_header('Content-Type',self.guess_type(str(target)))
        self.send_header('Content-Encoding','gzip');self.send_header('Content-Length',str(len(compressed)))
        self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(compressed)
    def log_message(self,*args):pass

print(f'Audit server http://127.0.0.1:{args.port}/screener/',flush=True)
for port in args.extra_ports:
    threading.Thread(target=ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever,daemon=True).start()
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
