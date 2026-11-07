const targets = await fetch("http://127.0.0.1:9228/json/list").then((response) => response.json());
const target = targets.find((item) => item.type === "page" && item.url === "http://127.0.0.1:10000/");
if (!target) throw new Error("Could not find the Audio Studio browser tab.");

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
const browserErrors = [];
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  } else if (message.method === "Runtime.exceptionThrown") {
    browserErrors.push({ type: "exception", details: message.params.exceptionDetails?.text });
  } else if (message.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(message.params.type)) {
    browserErrors.push({ type: message.params.type, text: message.params.args?.map((arg) => arg.value ?? arg.description).join(" ") });
  } else if (message.method === "Network.loadingFailed") {
    browserErrors.push({ type: "network", url: message.params.requestId, error: message.params.errorText });
  }
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

async function evaluate(expression) {
  const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  return response.result.result.value;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await command("Runtime.enable");
await command("Page.enable");
await command("Network.enable");
await command("Page.reload", { ignoreCache: true });
await pause(4500);

const compressor = await evaluate(`({title:document.title,ready:document.readyState,viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,main:document.querySelector('.compressor-main')?.getBoundingClientRect().width,buttons:[...document.querySelectorAll('.studio-tab')].map(x=>x.innerText.trim())})`);
await evaluate(`(()=>{const input=document.querySelector('input[type="file"]');const transfer=new DataTransfer();transfer.items.add(new File(['qa'], 'qa.mp3', {type:'audio/mpeg'}));Object.defineProperty(input,'files',{configurable:true,value:transfer.files});input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
await pause(250);
const compressorInteractions = await evaluate(`(()=>{const target=document.querySelector('#target-size');const before=target?.value;document.querySelectorAll('.preset-btn').length&&[...document.querySelectorAll('.preset-btn')].find(b=>b.textContent.includes('Small File'))?.click();return {selectedFiles:document.querySelectorAll('.audio-player-card').length,beforeTarget:before,selectedTarget:target?.value};})()`);
await evaluate(`document.querySelector('.remove-btn')?.click()`);
await pause(250);
compressorInteractions.removedFile = await evaluate(`document.querySelectorAll('.audio-player-card').length===0`);
await evaluate(`document.querySelector('.studio-tab:nth-child(2)')?.click()`);
await pause(2500);
const metatune = await evaluate(`(() => { const frame=document.querySelector('iframe.metatune-frame'); const d=frame?.contentDocument; if(!d) return {frame:frame?.src,loaded:false}; const views=[...d.querySelectorAll('.view')]; const active=views.find(v=>v.classList.contains('active')); return {frame:frame.src,loaded:d.readyState,title:d.title,view:active?.id,bodyWidth:d.body.scrollWidth,bodyClient:d.body.clientWidth}; })()`);

const navigation = await evaluate(`(async()=>{const d=document.querySelector('iframe.metatune-frame').contentDocument; const ids=[...d.querySelectorAll('.nav-item[data-target]')].map(x=>x.dataset.target).filter(id=>id.startsWith('view-')); const out=[]; for(const id of ids){d.querySelector('.nav-item[data-target="'+id+'"]').click(); await new Promise(r=>setTimeout(r,250)); const v=d.getElementById(id); const main=d.querySelector('.main-content'); out.push({id,active:v.classList.contains('active'),display:getComputedStyle(v).display,mainWidth:main.clientWidth,mainScrollWidth:main.scrollWidth});} return out;})()`);
await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await pause(700);
const responsive = await evaluate(`(async()=>{const d=document.querySelector('iframe.metatune-frame').contentDocument;const ids=[...d.querySelectorAll('.nav-item[data-target]')].map(x=>x.dataset.target).filter(id=>id.startsWith('view-'));const out=[];for(const id of ids){d.querySelector('.nav-item[data-target="'+id+'"]').click();await new Promise(r=>setTimeout(r,100));const v=d.getElementById(id),main=d.querySelector('.main-content');out.push({id,active:v.classList.contains('active'),mainWidth:main.clientWidth,mainScrollWidth:main.scrollWidth,viewWidth:v.clientWidth,viewScrollWidth:v.scrollWidth});}return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,compressorWidth:document.querySelector('.compressor-main').clientWidth,frameWidth:document.querySelector('iframe.metatune-frame').clientWidth,views:out};})()`);
await command("Emulation.clearDeviceMetricsOverride");
await pause(300);
const desktopOverflow = await evaluate(`(() => {const d=document.querySelector('iframe.metatune-frame').contentDocument;const m=d.querySelector('.main-content'),r=m.getBoundingClientRect();d.querySelector('.nav-item[data-target="view-settings"]').click();const nodes=[...m.querySelectorAll('*')].map(e=>{const b=e.getBoundingClientRect();return {tag:e.tagName,id:e.id,class:typeof e.className==='string'?e.className:'',left:Math.round(b.left-r.left),right:Math.round(b.right-r.left),width:Math.round(b.width),scrollWidth:e.scrollWidth,clientWidth:e.clientWidth}}).filter(x=>x.right>m.clientWidth+1||x.scrollWidth>x.clientWidth+4).slice(0,20);return {mainWidth:m.clientWidth,mainScrollWidth:m.scrollWidth,nodes};})()`);
await pause(500);
console.log(JSON.stringify({ compressor, compressorInteractions, metatune, navigation, responsive, desktopOverflow, browserErrors }, null, 2));
socket.close();
