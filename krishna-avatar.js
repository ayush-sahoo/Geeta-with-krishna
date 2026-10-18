// Talking Krishna (paid feature): the portrait in assets/krishna-avatar.webp
// speaks an Ask Krishna answer. tts-krishna returns the voice and the time each
// letter is spoken; the mouth shape follows the letters and the loudness of the
// voice, the eyes blink and the head sways a little. Loaded on first use.
(()=>{
// Landmarks are in pixels of the original 1254 px portrait; the shipped image
// is the 800 px square starting at (250,120). The flute and the hand holding it
// were painted out below the chin (the face is the original, pixel for pixel).
const TEX={x:250,y:120,s:800},VIEW={x:270,y:140,s:760};
const SEAM=[[TEX.x,611],[599,611],[625,604],[650,600],[675,590],[700,580],[710,576],[TEX.x+TEX.s,576]];
const XL=599,XR=710,XC=(XL+XR)/2,HW=(XR-XL)/2;
const EYES=[
  {x0:500,x1:602,brow:440,u:[[500,481],[515,474],[530,467],[547,462],[570,464],[602,477]],l:[[500,484],[515,489],[530,494],[553,497],[580,491],[602,481]]},
  {x0:648,x1:740,brow:404,u:[[648,449],[662,432],[693,422],[718,424],[740,431]],l:[[648,452],[662,454],[693,447],[718,438],[740,434]]}];
// The head is tilted, so the jaw opens along (DX,DY) rather than straight down.
const JAW=21,LIFT=4.5,DX=.21,DY=.98;
const sq=v=>v*v,sm=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)};
const pl=(pts,x)=>{if(x<=pts[0][0])return pts[0][1];for(let i=1;i<pts.length;i++)if(x<=pts[i][0]){const[a,b]=pts[i-1],[c,d]=pts[i];return b+(d-b)*(x-a)/(c-a)}return pts[pts.length-1][1]};
function seam(x){
  const P=SEAM;if(x<=P[1][0]||x>=P[P.length-2][0])return pl(P,x);
  let i=1;while(x>P[i+1][0])i++;
  const p0=P[i-1],p1=P[i],p2=P[i+1],p3=P[i+2],t=(x-p1[0])/(p2[0]-p1[0]),w=p2[0]-p1[0];
  const m1=(p2[1]-p0[1])/(p2[0]-p0[0])*w,m2=(p3[1]-p1[1])/(p3[0]-p1[0])*w,t2=t*t,t3=t2*t;
  return(2*t3-3*t2+1)*p1[1]+(t3-2*t2+t)*m1+(-2*t3+3*t2)*p2[1]+(t3-t2)*m2;
}
const lens=x=>{const u=(x-XC)/HW;return Math.abs(u)<1?Math.pow(1-u*u,1.15):0};
const bump=x=>Math.exp(-sq((x-XC)/62));
const widen=(x,y)=>7*((x-XC)/HW)*Math.exp(-sq((x-XC)/75)-sq((y-597)/28));
// Per vertex: movement per unit of mouth opening, mouth width and eyelid
// closing, and how much it follows the head.
function weights(x,y,lower){
  const s=seam(x),L=lens(x);
  const o=lower?JAW*(L+(bump(x)-L)*sm(0,22,y-s))*(1-sm(668,740,y)):-LIFT*L*Math.exp(-sq((s-y)/12));
  let b=0;
  for(const e of EYES){
    if(x<=e.x0||x>=e.x1)continue;
    const u=pl(e.u,x),l=pl(e.l,x);if(y<e.brow||y>l||u<=e.brow)continue;
    const f=y<=u?e.brow+(y-e.brow)*(l-e.brow)/(u-e.brow):l;
    b+=sm(e.x0,e.x0+12,x)*(1-sm(e.x1-12,e.x1,x))*(f-y);
  }
  return[o,widen(x,y),b,1-sm(600,800,y)];
}
const VS=`#version 300 es
in vec2 aPos;in vec4 aA;in float aAux;
uniform float uO,uW,uB,uRot,uScale;uniform vec2 uT;
out vec2 vP;out float vAux;
void main(){vP=aPos;vAux=aAux;
 vec2 p=aPos+vec2(uW*aA.y+uO*aA.x*${DX},uO*aA.x*${DY}+uB*aA.z);
 float a=uRot*aA.w;vec2 d=p-vec2(650.,760.);
 p=vec2(650.,760.)+vec2(cos(a)*d.x-sin(a)*d.y,sin(a)*d.x+cos(a)*d.y)+uT*aA.w;
 p=vec2(650.,1254.)+(p-vec2(650.,1254.))*uScale;
 vec2 c=(p-vec2(${VIEW.x}.,${VIEW.y}.))/${VIEW.s}.;gl_Position=vec4(c.x*2.-1.,1.-c.y*2.,0,1);}`;
const FS=`#version 300 es
precision highp float;in vec2 vP;in float vAux;uniform sampler2D uTex;uniform int uMode;uniform float uOpen;out vec4 o;
void main(){
 if(uMode==0){vec4 c=texture(uTex,(vP-vec2(${TEX.x}.,${TEX.y}.))/${TEX.s}.);o=vec4(c.rgb*(1.-.45*uOpen*vAux),1);return;}
 if(uMode==1){o=vec4(mix(vec3(.13,.03,.04),vec3(.42,.14,.16),smoothstep(602.,622.,vP.y)),1);return;}
 float k=abs(fract((vP.x-${XC.toFixed(1)})/9.+.5)-.5),side=1.-.55*pow(abs(vP.x-${XC.toFixed(1)})/42.,2.);
 vec3 c=vec3(.80,.75,.72)*side*mix(.9,1.,smoothstep(0.,.1,k))*mix(.75,1.,smoothstep(0.,.3,vAux));
 o=vec4(c*mix(.55,1.,smoothstep(0.,.35,vAux)),.85*smoothstep(0.,.3,vAux)*pow(1.-vAux,1.4)*smoothstep(0.,14.,36.-abs(vP.x-${XC.toFixed(1)})));}`;

function makeRenderer(canvas,img){
  const gl=canvas.getContext('webgl2',{antialias:true,alpha:false});
  if(!gl)return null;
  const sh=(t,src)=>{const x=gl.createShader(t);gl.shaderSource(x,src);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x};
  const pg=gl.createProgram();gl.attachShader(pg,sh(gl.VERTEX_SHADER,VS));gl.attachShader(pg,sh(gl.FRAGMENT_SHADER,FS));gl.linkProgram(pg);
  if(!gl.getProgramParameter(pg,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(pg));
  gl.useProgram(pg);
  const U={};for(const n of['uO','uW','uB','uRot','uScale','uT','uTex','uMode','uOpen'])U[n]=gl.getUniformLocation(pg,n);
  function vao(pos,att,aux,idx,dynamic){
    const v=gl.createVertexArray();gl.bindVertexArray(v);const bufs={};
    for(const[name,data,size]of[['aPos',pos,2],['aA',att,4],['aAux',aux,1]]){
      const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,dynamic?gl.DYNAMIC_DRAW:gl.STATIC_DRAW);
      const l=gl.getAttribLocation(pg,name);gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,size,gl.FLOAT,false,0,0);bufs[name]=b;
    }
    const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,idx,gl.STATIC_DRAW);
    return{v,bufs,n:idx.length};
  }
  // Face mesh, cut along the line between the lips so the mouth can open.
  const STEP=3,NU=165,NL=110,X0=TEX.x,X1=TEX.x+TEX.s,Y0=TEX.y,Y1=TEX.y+TEX.s,cols=[];
  for(let x=X0;x<X1;x+=STEP)cols.push(x);cols.push(X1);
  const R=NU+NL+2,nv=cols.length*R,pos=new Float32Array(nv*2),att=new Float32Array(nv*4),aux=new Float32Array(nv);
  let vi=0;
  for(const x of cols){const s=seam(x),L=lens(x);
    for(let j=0;j<R;j++){const lower=j>NU,y=lower?s+(Y1-s)*(j-NU-1)/NL:Y0+(s-Y0)*j/NU;
      pos[vi*2]=x;pos[vi*2+1]=y;att.set(weights(x,y,lower),vi*4);aux[vi]=L*Math.exp(-Math.abs(y-s)/4.5);vi++}}
  const idx=new Uint32Array((cols.length-1)*(NU+NL)*6);let k=0;
  for(let c=0;c<cols.length-1;c++)for(const[r0,n]of[[0,NU],[NU+1,NL]])for(let r=r0;r<r0+n;r++){const a=c*R+r,b=a+R;idx.set([a,b,a+1,a+1,b,b+1],k);k+=6}
  const face=vao(pos,att,aux,idx);
  const H=[0,0,0,1];
  const inner=vao(new Float32Array([XL-8,560,XR+8,560,XL-8,655,XR+8,655]),new Float32Array([...H,...H,...H,...H]),new Float32Array(4),new Uint32Array([0,1,2,2,1,3]));
  const TX=[];for(let x=XL+20;x<=XR-18;x+=2)TX.push(x);
  const tpos=new Float32Array(TX.length*4),tatt=new Float32Array(TX.length*8),taux=new Float32Array(TX.length*2),tidx=[];
  for(let i=0;i<TX.length;i++){tatt.set([...H,...H],i*8);taux.set([0,1],i*2);if(i)tidx.push(2*i-2,2*i,2*i-1,2*i-1,2*i,2*i+1)}
  const teeth=vao(tpos,tatt,taux,new Uint32Array(tidx),true);
  const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  return function draw(p){
    gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(1,.97,.91,1);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U.uRot,p.rot);gl.uniform1f(U.uScale,p.scale);gl.uniform2f(U.uT,p.tx,p.ty);
    gl.uniform1f(U.uO,0);gl.uniform1f(U.uW,0);gl.uniform1f(U.uB,0);
    gl.uniform1i(U.uMode,1);gl.bindVertexArray(inner.v);gl.drawElements(gl.TRIANGLES,inner.n,gl.UNSIGNED_INT,0);
    for(let i=0;i<TX.length;i++){const x=TX[i],s=seam(x),L=lens(x),lift=-LIFT*L*p.O;
      const xx=x+p.W*widen(x,s)+lift*DX,top=s+lift*DY,th=Math.min(8,.42*(JAW+LIFT)*Math.pow(L,1.3)*p.O);
      tpos.set([xx-2*DX,top-2*DY,xx+th*DX,top+th*DY],i*4)}
    gl.bindBuffer(gl.ARRAY_BUFFER,teeth.bufs.aPos);gl.bufferSubData(gl.ARRAY_BUFFER,0,tpos);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(U.uMode,2);gl.bindVertexArray(teeth.v);gl.drawElements(gl.TRIANGLES,teeth.n,gl.UNSIGNED_INT,0);
    gl.disable(gl.BLEND);
    gl.uniform1f(U.uO,p.O);gl.uniform1f(U.uW,p.W);gl.uniform1f(U.uB,p.B);gl.uniform1f(U.uOpen,p.O);
    gl.uniform1i(U.uMode,0);gl.bindVertexArray(face.v);gl.drawElements(gl.TRIANGLES,face.n,gl.UNSIGNED_INT,0);
  };
}

// ---- Letters -> mouth shapes: [opening 0-1, width -1 (round) .. 1 (wide)] ----
// Indian scripts share Devanagari's layout, so their letters are mapped onto
// it first. Other scripts fall back to a middle shape and the voice's loudness.
const DEVA_VOWEL={0x905:[.7,0],0x906:[.95,0],0x907:[.35,.5],0x908:[.35,.55],0x909:[.35,-.6],0x90A:[.35,-.7],0x90B:[.35,0],0x90F:[.55,.3],0x910:[.65,.2],0x913:[.6,-.5],0x914:[.65,-.4],0x911:[.7,-.3],0x912:[.6,-.5],0x90E:[.55,.3],
  0x93E:[.95,0],0x93F:[.35,.5],0x940:[.35,.55],0x941:[.35,-.6],0x942:[.35,-.7],0x943:[.35,0],0x947:[.55,.3],0x948:[.65,.2],0x94B:[.6,-.5],0x94C:[.65,-.4],0x949:[.7,-.3],0x94A:[.6,-.5],0x946:[.55,.3]};
const DEVA_LABIAL=new Set([0x92A,0x92B,0x92C,0x92D,0x92E,0x935]);
const INDIC=[0x980,0xA00,0xA80,0xB00,0xB80,0xC00,0xC80,0xD00];
function devanagari(c){const k=c.codePointAt(0);if(k>=0x900&&k<0x980)return k;for(const b of INDIC)if(k>=b&&k<b+0x80)return k-b+0x900;return 0}
const isDevaConsonant=k=>(k>=0x915&&k<=0x939)||(k>=0x958&&k<=0x95F);
const LATIN={a:[.85,0],e:[.5,.3],i:[.35,.5],y:[.35,.4],o:[.6,-.5],u:[.4,-.6],b:[0,0],p:[0,0],m:[0,0],f:[.1,0],v:[.1,0],w:[.3,-.6]};
const ARABIC={'ا':[.85,0],'آ':[.9,0],'و':[.45,-.5],'ی':[.4,.4],'ي':[.4,.4],'ے':[.45,.4],'ب':[0,0],'پ':[0,0],'م':[0,0]};
function mouthKeys(chars,start,end){
  const keys=[];
  for(let i=0;i<chars.length;i++){
    const c=chars[i],s=start[i],e=end[i],d=devanagari(c);
    if(d){
      if(DEVA_VOWEL[d]){const[o,w]=DEVA_VOWEL[d];keys.push([s+.3*(e-s),o,w])}
      else if(isDevaConsonant(d)){
        keys.push([s,DEVA_LABIAL.has(d)?0:.22,0]);
        // A consonant followed by another consonant carries the inherent "a".
        const n=devanagari(chars[i+1]||' ');if(n&&isDevaConsonant(n))keys.push([(s+e)/2+.01,.6,0]);
      }
      else if(d===0x902||d===0x901)keys.push([s,.3,0]);
      else if(d===0x964||d===0x965)keys.push([s,0,0],[e,0,0]);
      continue;
    }
    if(/\s/.test(c)){if(e-s>.15)keys.push([s+.05,0,0],[e-.05,0,0]);continue}
    if(/[.,;:!?،۔"“”()]/.test(c)){keys.push([s,0,0],[e,0,0]);continue}
    const lat=LATIN[c.toLowerCase()];
    if(lat){keys.push([s+.3*(e-s),...lat]);continue}
    if(/[a-z]/i.test(c)){keys.push([s,.25,0]);continue}
    if(ARABIC[c]){keys.push([s+.3*(e-s),...ARABIC[c]]);continue}
    if(/\p{L}/u.test(c))keys.push([s+.3*(e-s),.45,0]);
  }
  return keys.sort((a,b)=>a[0]-b[0]);
}
const HZ=100;
function curves(keys,duration){
  const n=Math.ceil((duration+1)*HZ),O=new Float32Array(n),W=new Float32Array(n);let k=0;
  if(keys.length)for(let i=0;i<n;i++){
    const t=i/HZ;while(k<keys.length-1&&keys[k+1][0]<=t)k++;
    if(t<keys[0][0]-.06||t>keys[keys.length-1][0]+.1)continue;
    const a=keys[k],b=keys[Math.min(k+1,keys.length-1)],f=b[0]>a[0]?Math.min(1,Math.max(0,(t-a[0])/(b[0]-a[0]))):0;
    O[i]=t<a[0]?a[1]*(1-(a[0]-t)/.06):a[1]+(b[1]-a[1])*f;W[i]=a[2]+(b[2]-a[2])*f;
  }
  // Smooth both ways so the mouth eases between shapes without lagging.
  const al=1-Math.exp(-1/(HZ*.035));
  for(const c of[O,W])for(const rev of[false,true]){let v=0;for(let j=0;j<n;j++){const i=rev?n-1-j:j;v+=al*(c[i]-v);c[i]=v}}
  return{O,W};
}
function loudness(buf){
  const d=buf.getChannelData(0),sr=buf.sampleRate,n=Math.ceil(buf.duration*HZ),w=Math.round(sr*.01),env=new Float32Array(n);
  for(let i=0;i<n;i++){const c=Math.round(i/HZ*sr);let s=0,m=0;for(let j=Math.max(0,c-w);j<Math.min(d.length,c+w);j++){s+=d[j]*d[j];m++}env[i]=Math.sqrt(s/Math.max(1,m))}
  const p95=[...env].sort((a,b)=>a-b)[Math.floor(n*.95)]||1;for(let i=0;i<n;i++)env[i]/=p95;
  const slow=new Float32Array(n),al=1-Math.exp(-1/(HZ*.25));let v=0;for(let i=0;i<n;i++){v+=al*(env[i]-v);slow[i]=v}
  return{env,slow};
}
const at=(arr,t)=>{if(!arr)return 0;const f=t*HZ,i=Math.floor(f);if(i<0||i>=arr.length-1)return 0;return arr[i]+(arr[i+1]-arr[i])*(f-i)};
function blinkAt(t){const c=t%4.3,phase=Math.floor(t/4.3)%3,b=[1.6,2.9,.8][phase],d=c-b;
  return d<0||d>=.17?0:d<.07?sm(0,.07,d):d<.09?1:1-sm(.09,.17,d)}

// ---- Stage: the portrait in a container. Idle (blinking, swaying) until it
// is given speech to say; used by the full-screen view and by Talk to Krishna.
const CSS=`.ka-stage{position:relative;overflow:hidden;background:#f3dfb5}
.ka-stage canvas,.ka-stage img{position:absolute;inset:0;width:100%;height:100%;display:block}
.ka-stage img{object-fit:cover;object-position:50% 50%;transform:scale(1.053)}
.ka-tag{position:absolute;left:0;right:0;bottom:0;padding:36px 16px 12px;background:linear-gradient(transparent,rgba(40,16,4,.6));color:#fff;display:flex;justify-content:space-between;align-items:center}
.ka-tag b{font-size:18px}.ka-bars{display:flex;gap:4px;align-items:center;height:24px}.ka-bars i{width:4px;height:4px;border-radius:2px;background:#f6c453}
.ka-words span{color:#c9b39f}.ka-words span.done{color:#5a260e}.ka-words span.now{color:#f47b17}
.ka{position:fixed;inset:0;z-index:2000;background:#fff8e9;display:flex;flex-direction:column;align-items:center;color:#5a260e}
.ka-top{width:100%;max-width:480px;display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px}
.ka-top b{font:600 20px Georgia,serif}.ka-close{border:0;background:none;font-size:28px;line-height:1;width:44px;height:44px;color:#5a260e}
.ka .ka-stage{width:min(calc(100vw - 28px),452px,48vh);aspect-ratio:1;border-radius:24px;box-shadow:0 14px 35px rgba(91,45,12,.2);flex:none}
.ka-status{margin:12px 16px 0;font-size:14px;color:#8a6955;text-align:center;min-height:20px}
.ka-text{flex:1;width:100%;max-width:480px;padding:4px 20px;overflow:hidden;position:relative}
.ka-words{font-size:19px;line-height:1.6;will-change:transform}
.ka-actions{display:flex;gap:10px;padding:10px 16px calc(14px + env(safe-area-inset-bottom))}
.ka-actions button{border:0;border-radius:18px;padding:12px 22px;font-weight:800;background:linear-gradient(180deg,#ffd65f,#f2b93b);color:#4a220c}`;
let imgReady=null;
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function addStyle(){if(!document.getElementById('kaStyle')){const st=el('style');st.id='kaStyle';st.textContent=CSS;document.head.appendChild(st)}}
function ensureImage(){
  if(!imgReady){const img=new Image();img.alt='Sri Krishna';img.src='assets/krishna-avatar.webp';imgReady=img.decode().then(()=>img)}
  return imgReady;
}
// container: an element sized by the page. Returns {speak, stop, setActive, destroy, ready}.
function stage(container){
  addStyle();container.classList.add('ka-stage');
  const tag=el('div','ka-tag'),bars=el('div','ka-bars');for(let i=0;i<5;i++)bars.append(el('i'));
  tag.append(el('b',null,'श्रीकृष्ण'),bars);container.append(tag);
  let renderer=null,canvas=null,raf=0,active=true,speech=null,dead=false,speakGeneration=0;
  const barEls=[...bars.children],t0=performance.now();
  function frame(){
    raf=0;if(!active||dead)return;
    const clock=(performance.now()-t0)/1000,s=speech,now=s?s.ctx.currentTime:0;
    // The clip playing now (a reply is a queue of sentence clips).
    const seg=s?.segs.find(g=>now>=g.start&&now<g.start+g.duration),t=seg?now-seg.start:-1;
    const e=seg?at(seg.env,t):0,gate=sm(.05,.2,e),lead=t+.02,P=2*Math.PI;
    const O=seg?Math.min(1,at(seg.curve.O,lead)*gate*(.75+.35*Math.min(e,1))):0,W=seg?at(seg.curve.W,lead)*gate:0;
    if(renderer)renderer({O,W,B:blinkAt(clock),rot:.011*Math.sin(P*.17*clock)+.005*Math.sin(P*.41*clock+1.1),
      tx:2.5*Math.sin(P*.13*clock+.5),ty:1.5*Math.sin(P*.23*clock)+3*(seg?at(seg.slow,t):0),scale:1+.004*Math.sin(P*clock/4.2)});
    barEls.forEach((b,i)=>{b.style.height=(4+20*Math.min(1,(seg?at(seg.env,t-i*.04):0)*(.6+.4*Math.sin(i*1.7+2))))+'px'});
    if(s){
      let cur=-1;
      s.words.forEach((w,i)=>{const c=now>=w.end?'done':now>=w.start?'now':'';if(w.el.className!==c)w.el.className=c;if(now>=w.start)cur=i});
      const box=s.wordsBox.parentElement,target=cur<0?0:Math.max(0,s.words[cur].el.offsetTop-s.wordsBox.offsetTop-box.clientHeight*.3);
      s.scroll+=(target-s.scroll)*.12;s.wordsBox.style.transform=`translateY(${-s.scroll}px)`;
      if(!s.pending&&now>s.end+.3){speech=null;s.done()}
    }
    raf=requestAnimationFrame(frame);
  }
  const ready=ensureImage().then(img=>{
    if(dead)return;
    canvas=el('canvas');canvas.width=canvas.height=Math.round(Math.max(300,Math.min(480,container.clientWidth||452))*Math.min(2,devicePixelRatio||1));
    try{renderer=makeRenderer(canvas,img)}catch(e){console.error(e);renderer=null}
    container.prepend(renderer?canvas:img.cloneNode());
    if(active&&!raf)raf=requestAnimationFrame(frame);
  });
  function stop(invalidate=true){if(invalidate)speakGeneration++;const s=speech;speech=null;if(s){for(const g of s.segs)try{g.source.stop()}catch(e){}s.done('stopped')}}
  // clips: one or more {audio_base64, alignment} (or promises of them, in
  // order) from tts-krishna. Each clip plays as soon as it is ready, right
  // after the one before; wordsBox gets the spoken words. Resolves when
  // Krishna finishes, or 'stopped' if interrupted.
  async function speak(clips,{ctx,wordsBox}){
    const request=++speakGeneration;stop(false);await ready;if(dead||request!==speakGeneration)return'stopped';
    let done;const finished=new Promise(r=>done=r);
    const s=speech={ctx,segs:[],words:[],wordsBox,scroll:0,end:0,pending:true,done};
    wordsBox.replaceChildren();wordsBox.style.transform='';
    if(active&&!raf)raf=requestAnimationFrame(frame);
    await ctx.resume();
    let next=ctx.currentTime+.15;
    for(const clip of [].concat(clips)){
      let d,buffer;
      try{
        d=await clip;if(speech!==s)return'stopped';
        buffer=await ctx.decodeAudioData(Uint8Array.from(atob(d.audio_base64),c=>c.charCodeAt(0)).buffer);
      }catch(e){if(speech!==s)return'stopped';const partial=s.segs.length>0;stop();if(!partial)throw e;throw new Error('Audio stopped before the full reply finished. Please close and try again.')}
      if(speech!==s)return'stopped';
      const start=Math.max(next,ctx.currentTime+.05),source=ctx.createBufferSource();
      source.buffer=buffer;source.connect(ctx.destination);source.start(start);
      const a=d.alignment,chars=a.characters,cs=a.character_start_times_seconds,ce=a.character_end_times_seconds,loud=loudness(buffer);
      s.segs.push({start,duration:buffer.duration,source,env:loud.env,slow:loud.slow,curve:curves(mouthKeys(chars,cs,ce),buffer.duration)});
      if(s.words.length)wordsBox.append(' ');
      let w=null;
      for(let i=0;i<chars.length;i++){
        if(/\s/.test(chars[i])){w=null;wordsBox.append(' ');continue}
        if(!w){w={start:start+cs[i],end:start+ce[i],text:'',el:el('span')};s.words.push(w);wordsBox.append(w.el)}
        w.text+=chars[i];w.end=start+ce[i];w.el.textContent=w.text;
      }
      next=start+buffer.duration;s.end=next;
    }
    s.pending=false;
    return finished;
  }
  function setActive(on){active=on;if(!on){stop();cancelAnimationFrame(raf);raf=0}else if(!raf)raf=requestAnimationFrame(frame)}
  function destroy(){setActive(false);dead=true;canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();container.replaceChildren()}
  return{speak,stop,setActive,destroy,ready,get speaking(){return !!speech}};
}

// ---- Full-screen view for "Hear Krishna say this" ----
let view=null;
function close(){
  if(!view)return;const v=view;view=null;
  v.stage.destroy();v.root.remove();document.documentElement.style.overflow=v.overflow;
  removeEventListener('keydown',v.onKey);v.onClose?.();
}
// opts: {ctx: AudioContext created during the tap, clips: [promise of {audio_base64, alignment}, …]
//        (sentence by sentence, in order), title, onError(message), onClose()}
async function open(opts){
  close();addStyle();
  const root=el('div','ka'),top=el('div','ka-top'),x=el('button','ka-close','×'),card=el('div');
  root.setAttribute('role','dialog');root.setAttribute('aria-label','Krishna speaking');x.type='button';x.setAttribute('aria-label','Close');
  top.append(el('b',null,opts.title||'Sri Krishna'),x);
  const status=el('div','ka-status','Krishna is getting ready to speak…'),textBox=el('div','ka-text'),wordsBox=el('div','ka-words');textBox.append(wordsBox);
  const actions=el('div','ka-actions'),replay=el('button',null,'↻ Hear again');replay.type='button';replay.hidden=true;actions.append(replay);
  root.append(top,card,status,textBox,actions);document.body.appendChild(root);
  const v=view={root,stage:stage(card),overflow:document.documentElement.style.overflow,onClose:opts.onClose,onKey:e=>{if(e.key==='Escape')close()}};
  document.documentElement.style.overflow='hidden';x.onclick=close;addEventListener('keydown',v.onKey);
  const play=async()=>{
    replay.hidden=true;
    try{
      const r=await v.stage.speak(opts.clips,{ctx:opts.ctx,wordsBox});
      if(view===v&&r!=='stopped'){status.textContent='';replay.hidden=false}
    }catch(e){
      if(view!==v)return;console.error(e);
      status.textContent=e?.message||'Could not play Krishna\'s voice. Please try again.';opts.onError?.(status.textContent);
    }
  };
  replay.onclick=play;
  Promise.resolve(opts.clips[0]).then(()=>{if(view===v)status.textContent=''},()=>{});
  await play();
}
window.KrishnaAvatar={open,close,isOpen:()=>!!view,stage,_test:{mouthKeys,devanagari}};
})();
