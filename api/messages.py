from http.server import BaseHTTPRequestHandler
import json, urllib.request

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        req = urllib.request.Request('https://api.anthropic.com/v1/messages',
            data=json.dumps(body).encode(),
            headers={'Content-Type':'application/json','x-api-key':'YOUR_KEY','anthropic-version':'2023-06-01'})
        resp = urllib.request.urlopen(req, timeout=90)
        data = resp.read()
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Access-Control-Allow-Origin','*')
        self.end_headers()
        self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Methods','POST,OPTIONS')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.end_headers()