import contextlib
import io
import json
import logging
import os
import re
import httpx
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

import qrcode
from weibo_cli import auth

logging.disable(logging.CRITICAL)
accounts = {'5351049607': 'luckyscript', '1562002727': 'jsjhlk'}
states = {uid: {'state': 'ready', 'name': name} for uid, name in accounts.items()}
pending = {}
diagnostics = {}
active = None
lock = threading.Lock()
nonce = secrets.token_hex(32)
directory = Path(os.environ.get('MOMENTS_WEIBO_WEB_CREDENTIAL_DIRECTORY', '/var/lib/rain-blog-moments/weibo-web'))
auth.save_credential = lambda credential: None


def private_write(file, data):
    temporary = file.with_suffix('.next')
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as output:
        json.dump(data, output)
    os.chmod(temporary, 0o600)
    os.replace(temporary, file)


def verify(uid, credential):
    diagnostics[uid] = {'hasSession': bool(credential.cookies.get('SUB'))}
    if not credential.cookies.get('SUB'):
        states[uid] = {'state': 'login_incomplete', 'name': accounts[uid]}; return
    with httpx.Client(cookies=credential.cookies, follow_redirects=False, timeout=25,
                      headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'}) as client:
        response = client.get('https://weibo.com/')
        diagnostics[uid]['homeStatus'] = response.status_code
        response.raise_for_status()
        marker = re.search(r'window\.\$CONFIG\s*=\s*(?=\{)', response.text)
        diagnostics[uid]['hasPageConfig'] = bool(marker)
        if not marker:
            states[uid] = {'state': 'login_incomplete', 'name': accounts[uid]}; return
        config, _ = json.JSONDecoder().raw_decode(response.text[marker.end():])
    diagnostics[uid]['configKeys'] = sorted(config.keys())
    user = config.get('user') or {}
    session_uid = str(user.get('idstr') or user.get('id') or config.get('uid') or '')
    diagnostics[uid]['hasIdentity'] = bool(session_uid)
    if not session_uid or config.get('login') is False:
        states[uid] = {'state': 'login_incomplete', 'name': accounts[uid]}; return
    diagnostics[uid]['matchesExpected'] = session_uid == uid
    if session_uid != uid:
        states[uid] = {'state': 'wrong_account', 'name': accounts[uid]}; return
    private_write(directory / (uid + '.json'), {'account': uid, 'cookies': credential.cookies, 'savedAt': time.time()})
    (directory / ('pending-' + uid + '.json')).unlink(missing_ok=True)
    pending.pop(uid, None)
    states[uid] = {'state': 'saved', 'name': accounts[uid]}


def login(uid, retry=False):
    global active
    def display(url):
        image = qrcode.make(url)
        stream = io.BytesIO(); image.save(stream, format='PNG')
        import base64
        states[uid] = {'state': 'waiting', 'name': accounts[uid], 'image': 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()}
        return True
    auth._display_qr_in_terminal = display
    try:
        if retry:
            credential = auth.Credential(json.loads((directory / ('pending-' + uid + '.json')).read_text())['cookies'])
        else:
            with contextlib.redirect_stdout(io.StringIO()):
                credential = auth.qr_login()
            pending[uid] = credential
            private_write(directory / ('pending-' + uid + '.json'), {'cookies': credential.cookies, 'savedAt': time.time()})
        verify(uid, credential)
    except Exception as error:
        if isinstance(error, httpx.HTTPStatusError):
            diagnostics.setdefault(uid, {})['httpStatus'] = error.response.status_code
        states[uid] = {'state': 'expired' if type(error).__name__ == 'QRExpiredError' else 'failed', 'name': accounts[uid], 'errorType': type(error).__name__}
    finally:
        with lock: active = None


PAGE = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>微博免费同步授权</title><style>body{max-width:760px;margin:6vh auto;padding:24px;background:#f4f0e6;color:#302f29;font:17px Georgia,"Songti SC",serif;line-height:1.8}h1{font-weight:400}section{margin:24px 0;padding:20px;border:1px solid #d7cbbb}button{padding:10px 18px;border:0;background:#45675b;color:white;font-size:16px;border-radius:4px;cursor:pointer}img{display:block;width:240px;height:240px;margin:20px 0}small{color:#777}p{margin:12px 0}.state{color:#964b37}</style>
<h1>微博免费同步授权</h1><p>请在微博 App 中切换到对应账号，再生成并扫描二维码。两个账号分别完成一次。</p><p>登录信息仅保存到您 ECS 的私有目录，用于同步公开微博和图片，不使用付费接口。</p>
<section><h2>luckyscript</h2><form method="post" action="/start"><input type="hidden" name="nonce" value="NONCE"><button name="uid" value="5351049607">为 luckyscript 生成二维码</button><button formaction="/retry" name="uid" value="5351049607">重试已有会话校验</button></form><p class="state" id="s5351049607">等待开始</p><img id="i5351049607" hidden alt="luckyscript 微博登录二维码"></section>
<section><h2>jsjhlk</h2><form method="post" action="/start"><input type="hidden" name="nonce" value="NONCE"><button name="uid" value="1562002727">为 jsjhlk 生成二维码</button><button formaction="/retry" name="uid" value="1562002727">重试已有会话校验</button></form><p class="state" id="s1562002727">等待开始</p><img id="i1562002727" hidden alt="jsjhlk 微博登录二维码"></section>
<small>网页只通过 SSH 本地转发访问；凭据文件权限为 0600，不显示在聊天、不进入代码仓库。</small>
<script>const words={ready:'等待开始',starting:'正在生成二维码…',waiting:'请使用对应微博账号扫码，并在手机确认',saved:'已登录并保存，可以继续另一个账号',expired:'二维码已过期，请重新生成',wrong_account:'已确认扫码账号与此处账号不同，请切换账号后重试',login_incomplete:'微博尚未返回完整登录状态，正在排查，无需反复扫码',failed:'登录验证遇到错误，正在排查'};async function refresh(){const r=await fetch('/status',{cache:'no-store'});if(!r.ok)return;const data=await r.json();for(const [uid,state] of Object.entries(data.accounts)){document.getElementById('s'+uid).textContent=words[state.state]||state.state;const img=document.getElementById('i'+uid);if(state.image){if(img.src!==state.image)img.src=state.image;img.hidden=false}else{img.hidden=true}}}refresh();setInterval(()=>refresh().catch(()=>{}),2000);</script></html>'''


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def send(self, data, content_type='text/html; charset=utf-8', status=200):
        self.send_response(status); self.send_header('Content-Type', content_type); self.send_header('Cache-Control', 'no-store'); self.send_header('X-Frame-Options', 'DENY'); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        if self.headers.get('Host') != '127.0.0.1:23383': return self.send(b'', status=403)
        if self.path == '/status': return self.send(json.dumps({'accounts': states}).encode(), 'application/json')
        if self.path == '/diagnostics': return self.send(json.dumps(diagnostics).encode(), 'application/json')
        if self.path != '/': return self.send(b'', status=404)
        self.send(PAGE.replace('NONCE', nonce).encode())
    def do_POST(self):
        global active
        if self.path not in ['/start', '/retry'] or self.headers.get('Origin') != 'http://127.0.0.1:23383': return self.send(b'', status=403)
        size = int(self.headers.get('Content-Length', '0'))
        if size > 2000: return self.send(b'', status=413)
        form = parse_qs(self.rfile.read(size).decode())
        uid = form.get('uid', [''])[0]
        if uid not in accounts or form.get('nonce', [''])[0] != nonce: return self.send(b'', status=403)
        with lock:
            if active is None:
                active = uid; states[uid] = {'state': 'starting', 'name': accounts[uid]}
                threading.Thread(target=login, args=(uid, self.path == '/retry'), daemon=True).start()
        self.send_response(303); self.send_header('Location', '/'); self.end_headers()


os.umask(0o077)
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
if directory.is_symlink() or directory.stat().st_mode & 0o077:
    raise RuntimeError('WEIBO_INSECURE_CREDENTIAL_DIRECTORY')
for uid in accounts:
    if (directory / (uid + '.json')).is_file(): states[uid] = {'state': 'saved', 'name': accounts[uid]}
ThreadingHTTPServer(('127.0.0.1', 23383), Handler).serve_forever()
