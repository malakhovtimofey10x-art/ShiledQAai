const ALL_TASKS = {
  frontend:[
    {id:"seo",   label:"SEO",           icon:"🔍",subtasks:["title tag","meta description","Open Graph","canonical","h1 structure","image alt text","schema markup"]},
    {id:"a11y",  label:"Accessibility", icon:"♿",subtasks:["alt attributes","ARIA roles","heading hierarchy","color contrast","focus management","form labels"]},
    {id:"mobile",label:"Mobile UX",     icon:"📱",subtasks:["viewport meta","touch targets","responsive images","font sizes","horizontal scroll"]},
    {id:"perf",  label:"Performance",   icon:"📊",subtasks:["render-blocking","image optimization","inline scripts","HTML size","lazy loading"]},
    {id:"ui",    label:"UI & Content",  icon:"🖼️", subtasks:["broken links","missing images","deprecated tags","content quality","CTA clarity"]},
    {id:"auth",  label:"Auth flows",    icon:"🔐",subtasks:["login page","signup page","password reset","protected routes"]},
  ],
  backend:[
    {id:"sec",   label:"Security headers",icon:"🛡️", subtasks:["HTTPS","HSTS","CSP","X-Frame-Options","X-Content-Type","Referrer-Policy"]},
    {id:"api",   label:"API & routing",  icon:"⚡",subtasks:["HTTP status","redirect chains","404 handling","response time","CORS"]},
    {id:"crawl", label:"Crawlability",   icon:"🕷️",subtasks:["robots.txt","sitemap.xml","canonical","noindex","structured data"]},
    {id:"forms", label:"Input security", icon:"📋",subtasks:["form action","autocomplete","input types","required fields","CSRF"]},
  ],
  both:[
    {id:"seo",   label:"SEO",           icon:"🔍",subtasks:["title tag","meta description","Open Graph","canonical","h1 structure","image alt text","schema markup"]},
    {id:"sec",   label:"Security headers",icon:"🛡️", subtasks:["HTTPS","HSTS","CSP","X-Frame-Options","X-Content-Type","Referrer-Policy"]},
    {id:"a11y",  label:"Accessibility", icon:"♿",subtasks:["alt attributes","ARIA roles","heading hierarchy","form labels","focus management"]},
    {id:"mobile",label:"Mobile UX",     icon:"📱",subtasks:["viewport meta","touch targets","responsive images","font sizes"]},
    {id:"perf",  label:"Performance",   icon:"📊",subtasks:["render-blocking","image optimization","inline scripts","HTML size"]},
    {id:"api",   label:"API & routing", icon:"⚡",subtasks:["HTTP status","redirect chains","response time","CORS"]},
    {id:"auth",  label:"Auth flows",    icon:"🔐",subtasks:["login page","signup page","password reset","protected routes"]},
    {id:"crawl", label:"Crawlability",  icon:"🕷️",subtasks:["robots.txt","sitemap.xml","canonical","structured data"]},
    {id:"ui",    label:"UI & Content",  icon:"🖼️", subtasks:["broken links","missing images","deprecated tags"]},
    {id:"forms", label:"Input security",icon:"📋",subtasks:["form action","autocomplete","input types","CSRF"]},
  ]
};

const SEV={critical:{color:"#ff5b7f",bg:"#1e0615",label:"CRITICAL"},high:{color:"#ff8c5b",bg:"#1e0e06",label:"HIGH"},medium:{color:"#f5d442",bg:"#1c1804",label:"MEDIUM"},low:{color:"#5bdfb0",bg:"#051a14",label:"LOW"},info:{color:"#7eb3ff",bg:"#060e22",label:"INFO"}};

let phase="idle",runCount=0,allIssues=[],report=null,detectedStack=null;
let running=false,currentUrl="",currentMode="both";
let siteData=null,activeTasks=[],staticFindings=[];

document.querySelectorAll(".mode-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{document.querySelectorAll(".mode-btn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");currentMode=btn.dataset.mode;});
});

async function fetchSite(url){
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"fetch",url})});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function callAI(provider,system,user,maxTokens=2000){
  const res=await fetch("/api/claude",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action:provider,system,user,max_tokens:maxTokens})});
  const d=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(d.error||`HTTP ${res.status}`);
  return d.text||"";
}
const callClaude=(s,u,m)=>callAI("claude",s,u,m);
const callGPT=(s,u,m)=>callAI("openai",s,u,m);

// ── Ensemble: normalize an issue's source tag (Claude → ChatGPT review) ──
function tagSource(issue){
  const s=String(issue.source||"").toLowerCase();
  if(s==="both"||s==="confirmed")return"both";
  if(s==="chatgpt"||s==="gpt"||s==="openai")return"gpt";
  if(s==="claude")return"claude";
  return"claude";
}

function parseJSON(raw){return JSON.parse(raw.replace(/```json\n?|\n?```/g,"").trim());}

function analyzeStatically(data){
  const html=data.html||"",headers=data.headers||{},findings=[];
  let doc;
  try{doc=new DOMParser().parseFromString(html,"text/html");}catch{doc=document.implementation.createHTMLDocument();}

  const title=doc.querySelector("title")?.textContent?.trim()||"";
  findings.push({check:"Title tag",pass:title.length>0&&title.length<=60,value:title||"MISSING",detail:!title?"Missing title tag":title.length>60?`Too long (${title.length} chars, max 60)`:`Good (${title.length} chars)`});

  const metaDesc=doc.querySelector('meta[name="description"]')?.getAttribute("content")||"";
  findings.push({check:"Meta description",pass:metaDesc.length>=50&&metaDesc.length<=160,value:metaDesc?`${metaDesc.length} chars`:"MISSING",detail:!metaDesc?"Missing meta description":metaDesc.length<50?"Too short (<50 chars)":metaDesc.length>160?"Too long (>160 chars)":"Good"});

  const vp=doc.querySelector('meta[name="viewport"]')?.getAttribute("content")||"";
  findings.push({check:"Viewport meta tag",pass:vp.includes("width=device-width"),value:vp||"MISSING",detail:!vp?"Missing — critical for mobile":!vp.includes("width=device-width")?"Incorrect viewport value":"Present and correct"});

  const h1s=doc.querySelectorAll("h1");
  findings.push({check:"H1 tag",pass:h1s.length===1,value:`${h1s.length} found`,detail:h1s.length===0?"No H1 tag found":h1s.length>1?`Multiple H1 tags (${h1s.length}) — hurts SEO`:"Single H1 — correct"});

  const imgs=doc.querySelectorAll("img");
  const noAlt=[...imgs].filter(i=>i.getAttribute("alt")===null).length;
  findings.push({check:"Image alt text",pass:noAlt===0,value:`${noAlt}/${imgs.length} missing`,detail:noAlt>0?`${noAlt} images missing alt — accessibility + SEO issue`:imgs.length===0?"No images found":"All images have alt attributes"});

  const ogT=doc.querySelector('meta[property="og:title"]'),ogD=doc.querySelector('meta[property="og:description"]'),ogI=doc.querySelector('meta[property="og:image"]');
  findings.push({check:"Open Graph tags",pass:!!(ogT&&ogD&&ogI),value:[ogT?"og:title":"",ogD?"og:desc":"",ogI?"og:image":""].filter(Boolean).join(", ")||"NONE",detail:!(ogT&&ogD&&ogI)?`Missing: ${[!ogT?"og:title":"",!ogD?"og:description":"",!ogI?"og:image":""].filter(Boolean).join(", ")})`:"All core OG tags present"});

  const can=doc.querySelector('link[rel="canonical"]')?.getAttribute("href")||"";
  findings.push({check:"Canonical tag",pass:!!can,value:can||"MISSING",detail:!can?"No canonical — duplicate content risk":"Present"});

  findings.push({check:"HTTPS",pass:!!(data.url?.startsWith("https://")),value:data.url?.startsWith("https://")?"Enabled":"HTTP only",detail:!data.url?.startsWith("https://")?"Site not served over HTTPS":"HTTPS enforced"});

  const rt=data.responseTime||0;
  findings.push({check:"Response time",pass:rt<2000,value:rt?`${rt}ms`:"unknown",detail:rt>3000?"Very slow (>3s) — major UX impact":rt>2000?"Slow (>2s) — needs improvement":rt>1000?"Acceptable but could be faster":"Good response time"});

  findings.push({check:"HTTP status code",pass:data.status>=200&&data.status<400,value:String(data.status||0),detail:data.status>=500?"Server error":data.status>=400?"Client error":data.status===0?"Could not connect":`OK (${data.status})`});

  const secHdrs={"strict-transport-security":"HSTS","content-security-policy":"CSP","x-frame-options":"X-Frame-Options","x-content-type-options":"X-Content-Type-Options","referrer-policy":"Referrer-Policy","permissions-policy":"Permissions-Policy"};
  Object.entries(secHdrs).forEach(([h,name])=>{
    const present=!!headers[h];
    findings.push({check:`${name} header`,pass:present,value:present?headers[h].slice(0,60):"MISSING",detail:!present?`Missing ${name} security header`:"Present"});
  });

  const inlineScripts=doc.querySelectorAll("script:not([src])").length;
  findings.push({check:"Inline scripts",pass:inlineScripts<3,value:`${inlineScripts}`,detail:inlineScripts>=5?`${inlineScripts} inline scripts — major XSS surface, blocks CSP`:inlineScripts>=3?`${inlineScripts} inline scripts — moderate XSS risk`:inlineScripts===0?"No inline scripts — excellent for CSP":`${inlineScripts} inline script(s)`});

  const forms=doc.querySelectorAll("form");
  const noAction=[...forms].filter(f=>!f.getAttribute("action")).length;
  findings.push({check:"Form action attributes",pass:noAction===0,value:`${forms.length} forms, ${noAction} missing`,detail:noAction>0?`${noAction} form(s) missing action attribute`:forms.length===0?"No forms found":"All forms have action attributes"});

  const htmlKB=Math.round((data.htmlLength||0)/1024);
  findings.push({check:"HTML document size",pass:htmlKB<100,value:`${htmlKB}KB`,detail:htmlKB>300?"Very large HTML (>300KB) — critical performance issue":htmlKB>100?"Large HTML (>100KB) — impacts parse time":"Good HTML size"});

  findings.push({check:"robots.txt",pass:data.robotsTxt===true,value:data.robotsTxt?"Found":"Not found",detail:!data.robotsTxt?"No robots.txt — crawlers have no directives":"Present"});
  findings.push({check:"sitemap.xml",pass:data.sitemapXml===true,value:data.sitemapXml?"Found":"Not found",detail:!data.sitemapXml?"No sitemap.xml — hurts search engine indexing":"Present"});

  const schemaBlocks=doc.querySelectorAll('script[type="application/ld+json"]').length;
  findings.push({check:"Schema markup (JSON-LD)",pass:schemaBlocks>0,value:schemaBlocks>0?`${schemaBlocks} block(s)`:"None",detail:schemaBlocks===0?"No structured data found — missed rich snippet opportunity":`${schemaBlocks} JSON-LD block(s) found`});

  const lang=doc.querySelector("html")?.getAttribute("lang")||"";
  findings.push({check:"HTML lang attribute",pass:!!lang,value:lang||"MISSING",detail:!lang?"Missing lang on <html> — screen readers can't determine language":`Set to "${lang}"`});

  const favicon=doc.querySelector('link[rel*="icon"]');
  findings.push({check:"Favicon",pass:!!favicon,value:favicon?"Present":"Missing",detail:!favicon?"No favicon defined":"Favicon present"});

  findings.push({check:"URL redirected",pass:!data.redirected,value:data.redirected?`→ ${data.finalUrl}`:"No redirect",detail:data.redirected?`Redirects to ${data.finalUrl} — check for unnecessary hops`:"No redirect"});

  const extCSS=[...doc.querySelectorAll('link[rel="stylesheet"][href]')].length;
  findings.push({check:"External stylesheets",pass:extCSS<=3,value:`${extCSS}`,detail:extCSS>5?`${extCSS} stylesheets — multiple render-blocking resources`:extCSS>3?`${extCSS} stylesheets — consider consolidating`:`${extCSS} stylesheet(s)`});

  return findings;
}

// ── Tech-stack fingerprinting — identifies framework/CMS/hosting from real data ──
function detectStack(data){
  const html=data&&data.html||"",headers=data&&data.headers||{},h=html.toLowerCase();
  const has=s=>h.indexOf(s)>-1;
  const fw=new Set(),lib=new Set();let cms=null,hosting=null;

  // Meta-frameworks
  if(has("__next_data__")||has("/_next/")||has('id="__next"'))fw.add("Next.js");
  if(has("__nuxt__")||has("/_nuxt/"))fw.add("Nuxt");
  if(has("__sveltekit")||has("/_app/immutable/"))fw.add("SvelteKit");
  if(has("/_astro/")||has("astro-island")||has("<astro-"))fw.add("Astro");
  if(has("___gatsby")||has('id="___gatsby"'))fw.add("Gatsby");
  if(has("__remixcontext")||has("/build/_shared/"))fw.add("Remix");
  // Base UI frameworks
  if(has("data-reactroot")||has("_reactlisten")||has("react-dom")||has("__reactcontainer"))fw.add("React");
  if(fw.has("Next.js")||fw.has("Gatsby")||fw.has("Remix"))fw.add("React");
  if(has("data-server-rendered")||has("__vue__")||/data-v-[0-9a-f]{8}/.test(h))fw.add("Vue");
  if(fw.has("Nuxt"))fw.add("Vue");
  if(has("ng-version")||has("_nghost")||has("<app-root"))fw.add("Angular");
  if(/svelte-[0-9a-z]{6}/.test(h)||fw.has("SvelteKit"))fw.add("Svelte");
  // CMS / site builders
  if(has("/wp-content/")||has("/wp-includes/")||has("wp-json"))cms="WordPress";
  else if(has("cdn.shopify.com")||has("shopify."))cms="Shopify";
  else if(has("static.wixstatic.com")||has("wix-")) cms="Wix";
  else if(has("data-wf-")||has(".webflow."))cms="Webflow";
  else if(has("squarespace"))cms="Squarespace";
  const genMatch=html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i);
  // Libraries
  if(has("jquery"))lib.add("jQuery");
  if(has("cdn.tailwindcss.com")||/class="[^"]*\b(sm:|md:|lg:|min-h-screen|space-y-\d|ring-\d)/.test(html))lib.add("Tailwind CSS");
  if(has("bootstrap.min")||has("bootstrap.css"))lib.add("Bootstrap");
  if(has("alpinejs")||/\sx-data=/.test(h))lib.add("Alpine.js");
  if(has("fonts.googleapis.com"))lib.add("Google Fonts");
  // Hosting (from headers)
  const server=(headers["server"]||"").toLowerCase();
  if(headers["x-vercel-id"]||headers["x-vercel-cache"]||server.indexOf("vercel")>-1)hosting="Vercel";
  else if(headers["x-nf-request-id"]||server.indexOf("netlify")>-1)hosting="Netlify";
  else if(headers["x-github-request-id"])hosting="GitHub Pages";
  else if(headers["cf-ray"]||server.indexOf("cloudflare")>-1)hosting="Cloudflare";
  else if(server)hosting=headers["server"];

  // Rendering mode — measured from real body content
  let rendering="unknown",bodyLen=0;
  try{
    const doc=new DOMParser().parseFromString(html,"text/html");
    bodyLen=((doc.body&&doc.body.textContent)||"").replace(/\s+/g," ").trim().length;
    const scripts=doc.querySelectorAll("script").length;
    const metaFw=fw.has("Next.js")||fw.has("Nuxt")||fw.has("Gatsby")||fw.has("Astro")||fw.has("SvelteKit");
    if(metaFw||cms)rendering="server-rendered";        // these emit rendered HTML
    else if(bodyLen<400&&scripts>0)rendering="client-rendered";  // empty shell + JS = SPA
    else if(bodyLen>=400)rendering=fw.size>0?"server-rendered":"static";
    else rendering=fw.size>0?"client-rendered":"static";
  }catch{}

  return{frameworks:[...fw],libraries:[...lib],cms,hosting,
    generator:genMatch?genMatch[1]:null,rendering,
    jsRendered:rendering==="client-rendered",bodyTextLength:bodyLen};
}

function stackSummary(s){
  if(!s)return"Plain HTML/CSS/JS";
  const parts=[];
  if(s.frameworks.length)parts.push(s.frameworks.join(" + "));
  if(s.cms)parts.push(s.cms);
  if(s.libraries.length)parts.push(s.libraries.join(", "));
  parts.push(s.rendering);
  if(s.hosting)parts.push("hosted on "+s.hosting);
  return parts.filter(Boolean).join(" · ")||"Plain HTML/CSS/JS";
}

function renderingNote(s){
  if(s&&s.jsRendered)
    return "IMPORTANT — RENDERING: This is a CLIENT-RENDERED JavaScript app. The HTML below is only the initial shell. Forms, navigation, interactive UI and most content are generated by JavaScript AFTER load and are NOT present in this HTML. You MUST NOT report missing forms, missing UI, missing content, missing routes, or 'no API detected' as issues — you cannot see the rendered DOM.";
  return "RENDERING: This site is server-rendered or static — the HTML below reflects what users and crawlers actually receive.";
}

function renderStackInfo(){
  const el=document.getElementById("stack-info");
  if(!el)return;
  if(!detectedStack){el.classList.add("hidden");el.innerHTML="";return;}
  el.classList.remove("hidden");
  const chips=[];
  detectedStack.frameworks.forEach(f=>chips.push(`<span class="stack-chip primary">${f}</span>`));
  if(detectedStack.cms)chips.push(`<span class="stack-chip primary">${detectedStack.cms}</span>`);
  detectedStack.libraries.forEach(l=>chips.push(`<span class="stack-chip">${l}</span>`));
  chips.push(`<span class="stack-chip">${detectedStack.rendering}</span>`);
  if(detectedStack.hosting)chips.push(`<span class="stack-chip">${detectedStack.hosting}</span>`);
  if(detectedStack.frameworks.length===0&&!detectedStack.cms)chips.unshift(`<span class="stack-chip">Plain HTML/CSS/JS</span>`);
  el.innerHTML=`<span class="stack-lead">Detected stack</span>${chips.join("")}`;
}

// ════════════════════════════════════════════════════════════════════
// SCORING ENGINE — deterministic, weighted, confidence-calibrated.
// The AI finds and explains issues; this code computes every number.
// Same issue list → same score, every time.
// ════════════════════════════════════════════════════════════════════
const CATEGORY_WEIGHTS={Security:26,Performance:22,SEO:20,Accessibility:18,"Best Practices":14};
const SEVERITY_PENALTY={critical:32,high:17,medium:8,low:3};
const SCORE_DECAY=0.82; // each successive issue in a category costs progressively less

// Confidence drawn from the ensemble: issues both engines independently
// flagged (or verified static checks) carry full weight; single-engine less.
function confidenceWeight(source){
  if(source==="both"||source==="static")return 1.0;
  if(source==="claude"||source==="gpt")return 0.72;
  return 0.85;
}
function confidenceLabel(source){
  if(source==="both")return"verified by both engines";
  if(source==="static")return"verified (static check)";
  if(source==="claude"||source==="gpt")return"single-engine";
  return"flagged";
}

// Map an audit category label to one of the 5 weighted scoring categories.
function scoreCategoryOf(label){
  const s=String(label||"").toLowerCase();
  if(/secur|auth|input|ssl|csp|xss|csrf|header|form/.test(s))return"Security";
  if(/perf|speed|load|cache|size|bundle|render/.test(s))return"Performance";
  if(/seo|crawl|meta|sitemap|robots|schema|index/.test(s))return"SEO";
  if(/access|a11y|aria|mobile|contrast|alt|wcag/.test(s))return"Accessibility";
  return"Best Practices";
}

// Flat issue list → 0-100. Severity-weighted, confidence-weighted,
// with diminishing returns so 10 minor issues never equal one critical.
function deductionScore(issues){
  if(!issues||issues.length===0)return 100;
  const sorted=[...issues].sort((a,b)=>(SEVERITY_PENALTY[b.severity]||0)-(SEVERITY_PENALTY[a.severity]||0));
  let total=0;
  sorted.forEach((iss,i)=>{
    const base=SEVERITY_PENALTY[iss.severity]||SEVERITY_PENALTY.low;
    total+=base*confidenceWeight(iss.source)*Math.pow(SCORE_DECAY,i);
  });
  return Math.max(0,Math.round(100-total));
}

function gradeFor(s){
  if(s>=97)return"A+";if(s>=93)return"A";if(s>=90)return"A-";
  if(s>=87)return"B+";if(s>=83)return"B";if(s>=80)return"B-";
  if(s>=77)return"C+";if(s>=73)return"C";if(s>=70)return"C-";
  if(s>=60)return"D";return"F";
}
function gradeColor(s){return s>=83?"#5bdfb0":s>=70?"#f5d442":s>=60?"#ff8c5b":"#ff5b7f";}

// Full weighted roll-up across the 5 categories.
function computeScore(issues){
  const buckets={};
  Object.keys(CATEGORY_WEIGHTS).forEach(c=>buckets[c]=[]);
  (issues||[]).forEach(iss=>{
    const c=scoreCategoryOf(iss.category);
    (buckets[c]||buckets["Best Practices"]).push(iss);
  });
  let weightedSum=0,weightTotal=0;
  const categories=Object.keys(CATEGORY_WEIGHTS).map(c=>{
    const list=buckets[c],score=deductionScore(list),weight=CATEGORY_WEIGHTS[c];
    weightedSum+=score*weight;weightTotal+=weight;
    return{name:c,weight,score,issueCount:list.length,
      critical:list.filter(i=>i.severity==="critical").length,
      high:list.filter(i=>i.severity==="high").length};
  });
  const overall=Math.round(weightedSum/weightTotal);
  return{overall,grade:gradeFor(overall),
    health:overall>=85?"healthy":overall>=60?"degraded":"critical",
    categories};
}

function renderRawData(data,findings){
  const box=document.getElementById("raw-box");
  if(!data){box.innerHTML=`<div style="color:var(--text-dim);text-align:center;padding:40px;">No data yet</div>`;return;}
  const h=data.headers||{};
  let html=`<div class="raw-section"><div class="raw-section-title">HTTP RESPONSE</div>`;
  [[`Status code`,data.status,data.status>=200&&data.status<400?"good":"bad"],[`Response time`,`${data.responseTime}ms`,data.responseTime<2000?"good":data.responseTime<3000?"warn":"bad"],[`Final URL`,data.finalUrl,data.finalUrl===data.url?"good":"warn"],[`Redirected`,data.redirected?"Yes":"No",data.redirected?"warn":"good"],[`HTML size`,`${Math.round((data.htmlLength||0)/1024)}KB`,data.htmlLength<100000?"good":"warn"],[`HTTPS`,data.url?.startsWith("https")?"Yes":"No",data.url?.startsWith("https")?"good":"bad"],[`robots.txt`,data.robotsTxt?"Found":"Missing",data.robotsTxt?"good":"warn"],[`sitemap.xml`,data.sitemapXml?"Found":"Missing",data.sitemapXml?"good":"warn"]].forEach(([k,v,c])=>{html+=`<div class="raw-row"><span class="raw-key">${k}</span><span class="raw-val ${c||""}">${v}</span></div>`;});
  html+=`</div><div class="raw-section"><div class="raw-section-title">SECURITY HEADERS</div>`;
  ["strict-transport-security","content-security-policy","x-frame-options","x-content-type-options","referrer-policy","permissions-policy","cross-origin-embedder-policy","cross-origin-opener-policy"].forEach(header=>{
    const v=h[header];html+=`<div class="raw-row"><span class="raw-key">${header}</span><span class="raw-val ${v?"good":"bad"}">${v?v.slice(0,80):"MISSING"}</span></div>`;
  });
  html+=`</div><div class="raw-section"><div class="raw-section-title">ALL RESPONSE HEADERS</div>`;
  Object.entries(h).sort().forEach(([k,v])=>{html+=`<div class="raw-row"><span class="raw-key">${k}</span><span class="raw-val">${String(v).slice(0,100)}</span></div>`;});
  html+=`</div>`;
  if(findings?.length){
    const passed=findings.filter(f=>f.pass).length;
    html+=`<div class="raw-section"><div class="raw-section-title">STATIC ANALYSIS — ${passed}/${findings.length} PASSED</div>`;
    findings.forEach(f=>{html+=`<div class="finding-item ${f.pass?"finding-pass":"finding-fail"}"><div style="font-size:9px;color:${f.pass?"#5bdfb0":"#ff5b7f"};letter-spacing:.1em;margin-bottom:3px;">${f.pass?"✓":"✗"} ${f.check} — ${f.value}</div><div style="color:var(--text-second);font-size:11px;">${f.detail}</div></div>`;});
    html+=`</div>`;
  }
  box.innerHTML=html;
}

async function runAgentTask(url,task,data,findings){
  const html=data?.html||"",headers=data?.headers||{};
  const taskFindings=findings.filter(f=>{
    const id=task.id;
    if(id==="seo")    return["Title tag","Meta description","H1 tag","Canonical tag","Open Graph tags","Schema markup (JSON-LD)","robots.txt","sitemap.xml"].includes(f.check);
    if(id==="sec")    return f.check.includes("header")||f.check==="HTTPS"||f.check==="Inline scripts";
    if(id==="a11y")   return["Image alt text","HTML lang attribute","Form action attributes"].includes(f.check);
    if(id==="mobile") return["Viewport meta tag","HTML document size","External stylesheets"].includes(f.check);
    if(id==="perf")   return["Response time","HTML document size","Inline scripts","External stylesheets"].includes(f.check);
    if(id==="api")    return["HTTP status code","URL redirected","Response time"].includes(f.check);
    if(id==="crawl")  return["robots.txt","sitemap.xml","Canonical tag","Schema markup (JSON-LD)"].includes(f.check);
    if(id==="ui")     return["Image alt text","Favicon","Title tag"].includes(f.check);
    if(id==="auth")   return f.check.includes("Form");
    if(id==="forms")  return f.check.includes("Form")||f.check==="Inline scripts";
    return true;
  });

  let htmlSnippet="";
  try{
    const doc=new DOMParser().parseFromString(html,"text/html");
    if(["seo","a11y","mobile"].includes(task.id)){const hm=html.match(/<head[\s\S]*?<\/head>/i);htmlSnippet=hm?hm[0].slice(0,3000):html.slice(0,2000);}
    else if(["forms","auth"].includes(task.id)){const fm=(html.match(/<form[\s\S]*?<\/form>/gi)||[]);htmlSnippet=fm.slice(0,3).join("\n").slice(0,3000);}
    else if(task.id==="ui"){htmlSnippet=html.slice(0,2500);}
  }catch{}

  const stackLine=stackSummary(detectedStack);
  const sys=`You are a senior QA engineer performing a real technical audit from ACTUAL fetched data: raw server HTML, real HTTP response headers, and verified static checks.

NON-NEGOTIABLE RULES:
1. Report ONLY issues you can directly verify from the data provided. Every issue must cite concrete evidence — a specific header value, a specific tag, or a specific static check marked FAIL.
2. NEVER speculate. Banned in findings: "likely", "probably", "may", "might", "appears", "seems", "unverified", "no evidence", "cannot confirm", "suggests", "could be". If the data does not let you verify it, DO NOT report it at all.
3. Static checks marked PASS are verified correct — never report them as problems. Static checks marked FAIL are verified real issues — include them.
4. A genuinely correct category scores 100 with an empty issues array. Do NOT invent issues to appear thorough. A generic best-practice note is not an issue unless it causes real, demonstrable harm to THIS specific site.
5. The "issues" array is for real problems only (severity critical/high/medium/low). Never put passing or informational notes in it.
6. Tailor every fix to the detected tech stack — give framework-specific code and configuration, never generic advice.`;
  const usr=`DEEP QA ANALYSIS: "${task.label}"
URL: ${url}
HTTP: ${data?.status} in ${data?.responseTime}ms | HTTPS: ${data?.url?.startsWith("https")?"yes":"no"}
DETECTED STACK: ${stackLine}
${renderingNote(detectedStack)}

VERIFIED STATIC FINDINGS FOR THIS CATEGORY (ground truth — trust these completely):
${taskFindings.map(f=>`${f.pass?"PASS":"FAIL"} — ${f.check}: ${f.detail} [${f.value}]`).join("\n")||"No specific static findings for this category"}

RESPONSE HEADERS (verified):
${Object.entries(headers).slice(0,15).map(([k,v])=>`${k}: ${v}`).join("\n")}

${htmlSnippet?`RAW HTML SNIPPET (initial server response only):\n${htmlSnippet}`:""}

Subtasks to consider: ${task.subtasks.join(", ")}

SCORING: Start at 100. Deduct ONLY for verified issues — critical -25, high -15, medium -8, low -3. Every static FAIL is a real deduction. Zero verified issues = score 100, status "pass". If all static checks PASS and nothing else is verifiably wrong, the score is 100.

Return ONLY this JSON (no other text):
{"status":"pass"|"fail"|"warning","score":<integer 0-100>,"issues":[{"severity":"critical"|"high"|"medium"|"low","title":"<specific title>","description":"<exact problem with concrete evidence from the data>","reproduction":"<exact steps>","fix":"<exact code or config tailored to ${stackLine}>"}],"summary":"<one sentence grounded in the real data>"}`;

  try{
    // ── Stage 1: Claude performs the primary analysis ──
    let primary=null,consolidated=null,engines;
    try{ primary=parseJSON(await callClaude(sys,usr,1500)); }
    catch(e){ addLog(`Claude analysis failed (${task.label}): ${e.message}`,"warn"); }

    if(primary){
      // ── Stage 2: ChatGPT peer-reviews and consolidates Claude's analysis ──
      const reviewSys=`You are a second senior QA engineer peer-reviewing a colleague's audit. Apply these rules strictly:
- DELETE any finding that is speculative or not verifiable from the provided data (anything hedged with "likely", "may", "appears", "no evidence", "unverified", "could", etc.).
- DELETE any finding about missing forms, missing UI, missing content, or missing routes if the site is client-rendered — that content is not in the HTML and its absence is not a defect.
- DELETE any finding that contradicts a static check marked PASS.
- KEEP and confirm only evidence-backed issues. Add a genuinely missed issue ONLY if you can cite concrete evidence for it.
- If after review there are zero verified issues, return an empty issues array and score 100.`;
      const reviewUsr=`${usr}

──────────────────────────────
FIRST ENGINEER'S ANALYSIS (peer-review this):
${JSON.stringify(primary)}
──────────────────────────────

Review the analysis above against the REAL DATA, then return the consolidated final analysis as ONLY this JSON:
{"status":"pass"|"fail"|"warning","score":<integer 0-100>,"issues":[{"severity":"critical"|"high"|"medium"|"low"|"info","title":"<title>","description":"<problem with real evidence>","reproduction":"<steps>","fix":"<code or config>","source":"both"|"chatgpt"}],"summary":"<one sentence>"}
For each issue, set "source" to "both" if you agree with the first engineer's finding, or "chatgpt" if you are adding a finding they missed. Drop false positives entirely.`;
      try{
        consolidated=parseJSON(await callGPT(reviewSys,reviewUsr,1700));
        engines=["Claude","ChatGPT"];
      }catch(e){
        addLog(`ChatGPT review unavailable (${task.label}): ${e.message} — using Claude only`,"warn");
      }
    }else{
      // Claude unavailable → ChatGPT runs the primary analysis instead
      try{
        consolidated=parseJSON(await callGPT(sys,usr,1500));
        engines=["ChatGPT"];
      }catch(e){
        addLog(`ChatGPT analysis failed (${task.label}): ${e.message}`,"warn");
      }
    }

    const result=consolidated||primary;
    if(result){
      result.engines=engines||["Claude"];
      const tagger=(consolidated&&primary)?tagSource:(primary?(()=>"claude"):(()=>"gpt"));
      // issues array = real problems only; informational notes never count
      result.issues=(result.issues||[]).filter(i=>i.severity&&i.severity!=="info").map(i=>({...i,source:tagger(i)}));
      // Score is COMPUTED from the issue list — the AI never picks the number.
      result.score=deductionScore(result.issues);
      result.status=result.score>=85?"pass":result.score>=60?"warning":"fail";
      return result;
    }
    throw new Error("both AI engines failed");
  }catch(e){
    addLog("AI analysis fell back to static for "+task.label+": "+e.message,"error");
    const issues=taskFindings.filter(f=>!f.pass).map(f=>({severity:f.check.includes("HTTPS")||f.check.includes("CSP")||f.check.includes("HSTS")?"high":"medium",title:f.check+" — "+f.value,description:f.detail,reproduction:"Check page source or response headers",fix:"Fix: "+f.check,source:"static"}));
    const score=deductionScore(issues);
    return{status:score>=85?"pass":score>=60?"warning":"fail",score,engines:["static"],issues,summary:`${taskFindings.filter(f=>f.pass).length}/${taskFindings.length} checks passed`};
  }
}

async function generateFullReport(url,taskResults,mode,data,findings){
  const issues=taskResults.flatMap(t=>(t.result?.issues||[]).map(i=>({...i,category:t.task.label})));
  const passed=findings.filter(f=>f.pass).length,total=findings.length;
  const avgScore=taskResults.length?Math.round(taskResults.reduce((s,t)=>s+(t.result?.score||0),0)/taskResults.length):0;
  const critCount=issues.filter(i=>i.severity==="critical").length;
  const highCount=issues.filter(i=>i.severity==="high").length;
  const usr=`Final QA report for: ${url}
Mode: ${mode} | HTTP: ${data?.status} in ${data?.responseTime}ms | HTTPS: ${data?.url?.startsWith("https")?"yes":"no"}
Detected stack: ${stackSummary(detectedStack)}
Verified static analysis: ${passed}/${total} checks passed
Average category score: ${avgScore}/100
Verified issues — critical: ${critCount} | high: ${highCount} | total: ${issues.length}

Task results:
${taskResults.map(t=>`${t.task.label}: score=${t.result?.score} status=${t.result?.status} — ${t.result?.summary}`).join("\n")}

Verified issues (${issues.length}):
${issues.map(i=>`[${i.severity.toUpperCase()}] ${i.category}: ${i.title}`).join("\n")||"none"}

Return ONLY JSON:
{"overall_score":<integer reflecting ONLY verified issues>,"health":"healthy"|"degraded"|"critical","headline":"<specific punchy summary grounded in a real finding>","top_priority":"<most impactful real fix>","next_run_recommendation":"<specific advice>","positive_findings":["<an actual verified passing thing>","<another>"]}

Scoring: zero verified issues = overall_score 100, health healthy. Otherwise <50 critical, 50-84 degraded, 85+ healthy. The score reflects ONLY verified issues — never inflate, never deflate.`;
  const sysR="Senior QA engineer producing a final report strictly from verified audit data. JSON only. Never speculate. The score reflects only verified issues — zero verified issues means a score of 100.";
  // Verified clean — every category passed with no real issues: a genuine 100
  if(issues.length===0){
    return{overall_score:100,health:"healthy",
      headline:"No verified issues — every audited category passed.",
      top_priority:"Nothing critical to fix. Maintain the current configuration.",
      next_run_recommendation:"Re-audit after your next deploy to catch any regressions.",
      positive_findings:taskResults.filter(t=>t.result?.status==="pass").map(t=>t.task.label+" passed").slice(0,6),
      engines:["Claude","ChatGPT"]};
  }
  // ── Deterministic weighted score — computed here, never picked by the AI ──
  const sc=computeScore(issues);

  // Verified clean — every category passed with no real issues: a genuine 100
  if(issues.length===0){
    return{overall_score:100,grade:"A+",health:"healthy",breakdown:sc.categories,
      headline:"No verified issues — every audited category passed.",
      top_priority:"Nothing critical to fix. Maintain the current configuration.",
      next_run_recommendation:"Re-audit after your next deploy to catch any regressions.",
      positive_findings:taskResults.filter(t=>t.result?.status==="pass").map(t=>t.task.label+" passed").slice(0,6),
      engines:["Claude","ChatGPT"]};
  }
  const [cR,gR]=await Promise.allSettled([
    callClaude(sysR,usr,1000),
    callGPT(sysR,usr,1000),
  ]);
  let cr=null,gr=null;
  if(cR.status==="fulfilled"){try{cr=parseJSON(cR.value);}catch{}}
  if(gR.status==="fulfilled"){try{gr=parseJSON(gR.value);}catch{}}
  // The AI provides the narrative; the SCORE is the computed weighted value.
  const prose=cr||gr||{};
  return{
    overall_score:sc.overall,grade:sc.grade,health:sc.health,breakdown:sc.categories,
    headline:prose.headline||`${issues.length} issue(s) found across ${sc.categories.filter(c=>c.issueCount>0).length} categories.`,
    top_priority:prose.top_priority||(issues[0]?`Fix: ${issues[0].title}`:"Address the highest-severity issues first."),
    next_run_recommendation:prose.next_run_recommendation||"Re-audit after addressing the high-severity items.",
    positive_findings:[...new Set([...(cr&&cr.positive_findings||[]),...(gr&&gr.positive_findings||[])])].slice(0,6),
    engines:cr&&gr?["Claude","ChatGPT"]:[cr?"Claude":gr?"ChatGPT":"computed"],
  };
}

function fmt(s){return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function pdotHtml(c,s){return`<span class="pdot" style="width:${s}px;height:${s}px;"><span class="pdot-ring" style="background:${c};"></span><span class="pdot-core" style="background:${c};"></span></span>`;}
function setDotColor(el,c){if(!el)return;el.querySelector(".pdot-ring").style.background=c;el.querySelector(".pdot-core").style.background=c;}

function addLog(msg,type="info"){
  const colors={info:"#4f8ef7",success:"#5bdfb0",warn:"#f5d442",error:"#ff5b7f",system:"#9b6dff",data:"#6e7fff"};
  const time=new Date().toLocaleTimeString("en-US",{hour12:false});
  const el=document.createElement("div");el.className="log-line";
  el.innerHTML=`<span class="log-time">${time}</span><span class="log-type" style="color:${colors[type]||colors.info}">[${type.toUpperCase()}]</span><span class="log-msg">${msg}</span>`;
  document.getElementById("logs-inner").appendChild(el);
  const box=document.getElementById("logs-box");box.scrollTop=box.scrollHeight;
}

function updateFetchStatus(d){
  const el=document.getElementById("fetch-status"),inner=document.getElementById("fetch-status-inner");
  if(!d){el.style.display="none";return;}
  el.style.display="block";
  const sc=d.status>=200&&d.status<400?"#5bdfb0":"#ff5b7f";
  const tc=d.responseTime<2000?"#5bdfb0":d.responseTime<3000?"#f5d442":"#ff5b7f";
  inner.innerHTML=`<div class="fstat"><div class="fstat-label">HTTP</div><div class="fstat-value" style="color:${sc}">${d.status}</div></div><div class="fstat"><div class="fstat-label">TIME</div><div class="fstat-value" style="color:${tc}">${d.responseTime}ms</div></div><div class="fstat"><div class="fstat-label">HTTPS</div><div class="fstat-value" style="color:${d.url?.startsWith("https")?"#5bdfb0":"#ff5b7f"}">${d.url?.startsWith("https")?"✓":"✗"}</div></div><div class="fstat"><div class="fstat-label">HTML</div><div class="fstat-value">${Math.round((d.htmlLength||0)/1024)}KB</div></div><div class="fstat"><div class="fstat-label">HSTS</div><div class="fstat-value" style="color:${d.headers?.["strict-transport-security"]?"#5bdfb0":"#ff5b7f"}">${d.headers?.["strict-transport-security"]?"✓":"✗"}</div></div><div class="fstat"><div class="fstat-label">CSP</div><div class="fstat-value" style="color:${d.headers?.["content-security-policy"]?"#5bdfb0":"#ff5b7f"}">${d.headers?.["content-security-policy"]?"✓":"✗"}</div></div><div class="fstat"><div class="fstat-label">robots.txt</div><div class="fstat-value" style="color:${d.robotsTxt?"#5bdfb0":"#f5d442"}">${d.robotsTxt?"✓":"✗"}</div></div><div class="fstat"><div class="fstat-label">sitemap</div><div class="fstat-value" style="color:${d.sitemapXml?"#5bdfb0":"#f5d442"}">${d.sitemapXml?"✓":"✗"}</div></div>${d.error?`<div class="fstat"><div class="fstat-label">ERROR</div><div class="fstat-value" style="color:#ff5b7f">${d.error.slice(0,40)}</div></div>`:""}`;
}

function renderTaskCard(task,state){
  const el=document.getElementById("tc-"+task.id);if(!el)return;
  const{phase:p,result,subtaskIndex:si}=state;
  const status=result?.status||"idle",score=result?.score;
  const sc=p==="running"?"#4f8ef7":status==="pass"?"#5bdfb0":status==="fail"?"#ff5b7f":status==="warning"?"#f5d442":"#3a3a6a";
  if(p==="running"){el.classList.add("running");el.querySelector(".task-scan-bar").style.display="block";}
  else{el.classList.remove("running");el.querySelector(".task-scan-bar").style.display="none";}
  el.querySelector(".task-corner").style.background=p==="done"?`radial-gradient(circle at top right,${sc}18,transparent 70%)`:"none";
  const sb=el.querySelector(".task-score");
  if(score!==undefined){sb.textContent=score;sb.style.color=sc;sb.style.borderColor=sc+"35";sb.style.background=sc+"10";sb.style.display="inline";}else sb.style.display="none";
  const st=el.querySelector(".task-status-txt");
  if(p==="done"){st.textContent=status.toUpperCase();st.style.color=sc;st.style.display="inline";}else st.style.display="none";
  const rd=el.querySelector(".task-run-dot");
  if(p==="running"){rd.style.display="inline-block";setDotColor(rd,"#4f8ef7");}else rd.style.display="none";
  const body=el.querySelector(".task-body");body.innerHTML="";
  if(p==="idle"){const pills=document.createElement("div");pills.className="subtask-pills";task.subtasks.forEach(s=>{const sp=document.createElement("span");sp.className="subtask-pill";sp.textContent=s;pills.appendChild(sp);});body.appendChild(pills);}
  if(p==="running"){
    const pills=document.createElement("div");pills.className="subtask-pills";
    task.subtasks.forEach((s,i)=>{const sp=document.createElement("span");sp.className="subtask-pill"+(i===si?" active":i<si?" done":"");sp.textContent=(i<si?"✓ ":i===si?"▶ ":"")+s;pills.appendChild(sp);});
    body.appendChild(pills);
    const chk=document.createElement("div");chk.className="task-checking";chk.textContent="checking "+task.subtasks[si||0]+"...";body.appendChild(chk);
  }
  if(p==="done"&&result){
    const sum=document.createElement("p");sum.className="task-summary";sum.textContent=result.summary;body.appendChild(sum);
    if(result.issues?.length>0){const iw=document.createElement("div");iw.className="task-issues";result.issues.forEach(issue=>{const s=SEV[issue.severity]||SEV.info;const row=document.createElement("div");row.className="task-issue";row.style.background=s.bg;row.style.borderColor=s.color+"25";row.innerHTML=`<span class="issue-badge" style="color:${s.color}">${s.label}</span><span class="issue-title-sm">${issue.title}</span>`;iw.appendChild(row);});body.appendChild(iw);}
    else{const ni=document.createElement("div");ni.className="no-issues";ni.textContent="✓ No issues found";body.appendChild(ni);}
  }
}

function buildTaskGrid(){
  const grid=document.getElementById("tasks-grid");grid.innerHTML="";
  activeTasks.forEach(task=>{
    const card=document.createElement("div");card.className="task-card";card.id="tc-"+task.id;
    card.innerHTML=`<div class="task-scan-bar" style="display:none;"></div><div class="task-corner"></div><div class="task-header"><div class="task-title"><span class="task-icon">${task.icon}</span><span class="task-name">${task.label}</span></div><div class="task-meta"><span class="pdot task-run-dot" style="width:7px;height:7px;display:none;"><span class="pdot-ring" style="background:#4f8ef7;"></span><span class="pdot-core" style="background:#4f8ef7;"></span></span><span class="task-score" style="display:none;"></span><span class="task-status-txt" style="display:none;"></span></div></div><div class="task-body"></div>`;
    grid.appendChild(card);renderTaskCard(task,{phase:"idle"});
  });
}

function modelBadge(src){
  if(src==="both")return`<span class="model-badge" style="color:#5bdfb0;border-color:#5bdfb055;background:#5bdfb012;">BOTH ✓</span>`;
  if(src==="gpt")return`<span class="model-badge" style="color:#10a37f;border-color:#10a37f55;background:#10a37f12;">CHATGPT</span>`;
  if(src==="claude")return`<span class="model-badge" style="color:#7eb3ff;border-color:#7eb3ff55;background:#7eb3ff12;">CLAUDE</span>`;
  if(src==="static")return`<span class="model-badge" style="color:#8890cc;border-color:#8890cc55;background:#8890cc12;">STATIC</span>`;
  return"";
}
function renderIssues(){
  const list=document.getElementById("issues-list"),empty=document.getElementById("issues-empty");
  list.innerHTML="";
  if(allIssues.length===0){empty.style.color=phase==="running"?"var(--text-dim)":"#5bdfb0";empty.textContent=phase==="running"?"Scan in progress...":"✓ No issues found.";empty.style.display="block";return;}
  empty.style.display="none";
  document.getElementById("tab-issues-btn").textContent=`Issues (${allIssues.length})`;
  ["critical","high","medium","low","info"].forEach(sev=>{
    allIssues.filter(i=>i.severity===sev).forEach(issue=>{
      const s=SEV[issue.severity]||SEV.info;
      const row=document.createElement("div");row.className="issue-row";
      row.innerHTML=`<div class="issue-row-head"><span class="issue-sev-badge" style="color:${s.color};border-color:${s.color}45;background:${s.color}12;">${s.label}</span><span class="issue-row-title">${issue.title}</span>${modelBadge(issue.source)}<span class="issue-row-cat">${issue.category}</span><span class="issue-row-arrow">▼</span></div><div class="issue-row-body"><div class="issue-section"><div class="issue-section-label" style="color:#4f8ef7;">DESCRIPTION</div><div class="issue-section-text" style="color:var(--text-second);">${issue.description}</div></div><div class="issue-section"><div class="issue-section-label" style="color:#6e7fff;">REPRODUCTION</div><div class="issue-section-text" style="color:var(--text-second);">${issue.reproduction}</div></div><div class="issue-section"><div class="issue-section-label" style="color:#5bdfb0;">SUGGESTED FIX</div><div class="issue-section-text" style="color:#90e0c0;">${issue.fix}</div></div></div>`;
      row.querySelector(".issue-row-head").addEventListener("click",()=>{const b=row.querySelector(".issue-row-body"),a=row.querySelector(".issue-row-arrow"),open=b.classList.toggle("open");a.textContent=open?"▲":"▼";row.style.borderColor=open?s.color+"38":"var(--border)";row.style.boxShadow=open?`0 0 18px ${s.color}12`:"none";});
      list.appendChild(row);
    });
  });
}

function updateMetrics(){
  if(!report)return;
  document.getElementById("metrics").classList.remove("hidden");
  const s=report.overall_score,color=s>=80?"#5bdfb0":s>=60?"#f5d442":"#ff5b7f";
  const circ=2*Math.PI*30,dash=(s/100)*circ;
  document.getElementById("score-arc").setAttribute("stroke",color);document.getElementById("score-arc").setAttribute("stroke-dasharray",dash+" "+circ);
  document.getElementById("score-text").setAttribute("fill",color);document.getElementById("score-text").textContent=s;
  document.getElementById("score-ring").style.filter=`drop-shadow(0 0 8px ${color}50)`;
  const hc=report.health==="healthy"?"#5bdfb0":report.health==="degraded"?"#f5d442":"#ff5b7f";
  const mvs=document.getElementById("mv-status");mvs.textContent=report.health.toUpperCase();mvs.style.color=hc;mvs.style.textShadow=`0 0 20px ${hc}55`;
  const ic=allIssues.length,icol=ic>0?"#ff8c5b":"#5bdfb0";const mvi=document.getElementById("mv-issues");mvi.textContent=ic;mvi.style.color=icol;mvi.style.textShadow=`0 0 20px ${icol}55`;
  const cc=allIssues.filter(i=>i.severity==="critical").length,ccol=cc>0?"#ff5b7f":"#5bdfb0";const mvc=document.getElementById("mv-critical");mvc.textContent=cc;mvc.style.color=ccol;mvc.style.textShadow=`0 0 20px ${ccol}55`;
  const hh=allIssues.filter(i=>i.severity==="high").length,hcol=hh>0?"#ff8c5b":"#5bdfb0";const mvh=document.getElementById("mv-high");mvh.textContent=hh;mvh.style.color=hcol;mvh.style.textShadow=`0 0 20px ${hcol}55`;
  const mvt=document.getElementById("mv-tasks");mvt.textContent=activeTasks.length;mvt.style.color="#7eb3ff";mvt.style.textShadow="0 0 20px #7eb3ff55";
}

function renderReport(){
  const placeholder=document.getElementById("report-placeholder"),content=document.getElementById("report-content");
  if(!report){placeholder.style.display="block";content.classList.add("hidden");return;}
  placeholder.style.display="none";content.classList.remove("hidden");content.innerHTML="";
  const hc=document.createElement("div");hc.className="report-card";hc.innerHTML=`<div class="report-card-bar"></div><div class="report-label">${(report.engines||["AI"]).join(" + ").toUpperCase()} ASSESSMENT — ${currentMode.toUpperCase()} SCAN · REAL HTTP DATA</div><p class="report-headline">${report.headline}</p><p class="report-rec">${report.next_run_recommendation}</p>`;content.appendChild(hc);
  if(report.top_priority){const pc=document.createElement("div");pc.className="priority-card";pc.innerHTML=`<span class="priority-icon">🎯</span><div><div class="priority-label">TOP PRIORITY</div><p class="priority-text">${report.top_priority}</p></div>`;content.appendChild(pc);}
  if(report.breakdown&&report.breakdown.length){
    const sb=document.createElement("div");sb.className="report-card score-breakdown";
    const gc=gradeColor(report.overall_score);
    let sh=`<div class="report-card-bar"></div><div class="sb-head"><div><div class="report-label">WEIGHTED SCORE BREAKDOWN</div><div class="sb-sub">Each category scored from verified issues, then weighted into the overall.</div></div><div class="sb-grade" style="color:${gc};border-color:${gc}45;background:${gc}12;">${report.grade||gradeFor(report.overall_score)}</div></div>`;
    report.breakdown.forEach(c=>{
      const col=gradeColor(c.score);
      sh+=`<div class="sb-row"><span class="sb-name">${c.name}</span><span class="sb-weight">${c.weight}% wt</span><div class="sb-bar"><div class="sb-fill" style="width:${c.score}%;background:${col};"></div></div><span class="sb-score" style="color:${col};">${c.score}</span></div>`;
    });
    sb.innerHTML=sh;content.appendChild(sb);
  }
  if(report.positive_findings?.length>0){const pos=document.createElement("div");pos.className="positives-card";let h=`<div class="positives-label">WHAT'S WORKING</div>`;report.positive_findings.forEach(f=>{h+=`<div class="positive-item"><span class="positive-check">✓</span><span>${f}</span></div>`;});pos.innerHTML=h;content.appendChild(pos);}
  const bc=document.createElement("div");bc.className="breakdown-card";let bh=`<div class="breakdown-label">ISSUE BREAKDOWN</div><div class="breakdown-grid">`;
  ["critical","high","medium","low"].forEach(sev=>{const s=SEV[sev],count=allIssues.filter(i=>i.severity===sev).length;bh+=`<div class="breakdown-item" style="background:${s.bg};border-color:${s.color}25;box-shadow:0 0 14px ${s.color}14;"><div class="breakdown-num" style="color:${s.color};text-shadow:0 0 16px ${s.color}80;">${count}</div><div class="breakdown-name" style="color:${s.color};">${sev}</div></div>`;});
  bh+="</div>";bc.innerHTML=bh;content.appendChild(bc);
}

async function startScan(targetUrl,mode){
  if(running)return;
  running=true;phase="running";currentUrl=targetUrl;currentMode=mode;
  allIssues=[];report=null;siteData=null;staticFindings=[];detectedStack=null;runCount++;
  activeTasks=ALL_TASKS[mode]||ALL_TASKS.both;

  document.getElementById("hero").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  document.getElementById("fetch-status").style.display="none";
  document.getElementById("status-url").textContent=targetUrl;
  document.getElementById("run-label").textContent="run #"+runCount;
  document.getElementById("rescan-btn").classList.add("hidden");
  document.getElementById("status-mode-badge").textContent=mode.toUpperCase()+" SCAN";
  setDotColor(document.getElementById("status-dot"),"#4f8ef7");
  const hs=document.getElementById("header-status");hs.classList.remove("hidden");hs.style.display="flex";
  document.getElementById("header-status-text").textContent="scanning";
  setDotColor(document.getElementById("header-dot"),"#4f8ef7");
  document.getElementById("metrics").classList.add("hidden");
  document.getElementById("stack-info").classList.add("hidden");
  document.getElementById("report-placeholder").textContent="Scan in progress...";
  document.getElementById("report-placeholder").style.display="block";
  document.getElementById("report-content").classList.add("hidden");
  document.getElementById("issues-empty").style.color="var(--text-dim)";
  document.getElementById("issues-empty").textContent="Scan in progress...";
  document.getElementById("issues-empty").style.display="block";
  document.getElementById("issues-list").innerHTML="";
  document.getElementById("tab-issues-btn").textContent="Issues";
  document.getElementById("fix-placeholder").style.display="block";document.getElementById("fix-content").classList.add("hidden");document.getElementById("fix-content").innerHTML="";
  document.getElementById("tab-fix-btn").style.color="#c4a0ff";
  document.getElementById("raw-box").innerHTML=`<div style="color:var(--text-dim);text-align:center;padding:40px;">Fetching real site data...</div>`;
  buildTaskGrid();document.getElementById("logs-inner").innerHTML="";
  activateTab("tasks");

  addLog(`Scan started — mode: ${mode.toUpperCase()} — target: ${targetUrl}`,"system");
  addLog(`${activeTasks.length} test categories queued`,"info");

  // PHASE 1: Real HTTP fetch
  addLog("Fetching target site via real HTTP request...","data");
  try{
    siteData=await fetchSite(targetUrl);
    updateFetchStatus(siteData);
    if(siteData.error){addLog(`Fetch warning: ${siteData.error}`,"warn");}
    else{addLog(`Fetched ${Math.round((siteData.htmlLength||0)/1024)}KB HTML — HTTP ${siteData.status} in ${siteData.responseTime}ms`,"success");}
    if(siteData.redirected)addLog(`Redirected to: ${siteData.finalUrl}`,"warn");
    const h=siteData.headers||{};
    addLog(`HTTPS:${siteData.url?.startsWith("https")?"✓":"✗"} HSTS:${h["strict-transport-security"]?"✓":"✗"} CSP:${h["content-security-policy"]?"✓":"✗"} X-Frame:${h["x-frame-options"]?"✓":"✗"}`,"data");
    addLog(`robots.txt:${siteData.robotsTxt?"✓":"✗"} sitemap.xml:${siteData.sitemapXml?"✓":"✗"}`,"data");
  }catch(e){
    addLog(`Fetch failed: ${e.message}`,"error");
    siteData={url:targetUrl,status:0,error:e.message,headers:{},html:"",htmlLength:0,responseTime:0,robotsTxt:false,sitemapXml:false};
    updateFetchStatus(siteData);
  }

  // PHASE 2: Static analysis
  // PHASE 2: Static analysis + stack detection
  addLog("Running static analysis on real HTML...","data");
  staticFindings=analyzeStatically(siteData);
  detectedStack=detectStack(siteData);
  renderStackInfo();
  addLog(`Stack detected — ${stackSummary(detectedStack)}`,"data");
  if(detectedStack.jsRendered)addLog("Client-rendered app — audit weighted to skip JS-only DOM checks","info");
  const passed=staticFindings.filter(f=>f.pass).length;
  const failed=staticFindings.filter(f=>!f.pass).length;
  addLog(`Static: ${passed}/${staticFindings.length} passed — ${failed} issue(s) detected`,"data");
  staticFindings.filter(f=>!f.pass).forEach(f=>addLog(`  ✗ ${f.check}: ${f.detail}`,"warn"));
  renderRawData(siteData,staticFindings);

  // PHASE 3: AI deep analysis
  const taskResults=[];
  for(const task of activeTasks){
    addLog(`▶ ${task.label} — Claude + ChatGPT analysis...`,"info");
    renderTaskCard(task,{phase:"running",subtaskIndex:0});
    for(let i=0;i<task.subtasks.length;i++){renderTaskCard(task,{phase:"running",subtaskIndex:i});await sleep(180+Math.random()*120);}
    const result=await runAgentTask(targetUrl,task,siteData,staticFindings);
    taskResults.push({task,result});renderTaskCard(task,{phase:"done",result});
    const cc=(result.issues||[]).filter(i=>i.severity==="critical").length,cnt=(result.issues||[]).length;
    if(result.status==="fail"||cc>0)addLog(`  ✗ ${task.label}: score ${result.score} — ${cnt} issues (${cc} critical)`,"error");
    else if(result.status==="warning")addLog(`  ⚠ ${task.label}: score ${result.score} — ${cnt} warnings`,"warn");
    else addLog(`  ✓ ${task.label}: score ${result.score} — clean`,"success");
    const newIssues=(result.issues||[]).map(i=>({...i,category:task.label}));
    allIssues=[...allIssues,...newIssues];
    if(newIssues.length>0)renderIssues();
  }

  // PHASE 4: Final report
  addLog("Generating final AI report...","system");
  report=await generateFullReport(targetUrl,taskResults,mode,siteData,staticFindings);
  const cc2=allIssues.filter(i=>i.severity==="critical").length;
  addLog(`━━━ COMPLETE ━━━ Score: ${report.overall_score}/100  Health: ${report.health?.toUpperCase()}`,"system");
  addLog(`${cc2} critical · ${allIssues.filter(i=>i.severity==="high").length} high · ${allIssues.filter(i=>i.severity==="medium").length} medium · ${allIssues.filter(i=>i.severity==="low").length} low`,cc2>0?"error":"warn");
  addLog(`Static checks: ${passed}/${staticFindings.length} passed`,"data");

  phase="done";running=false;
  renderIssues();updateMetrics();renderReport();
  if(currentUser)saveScan(targetUrl,mode);
  setDotColor(document.getElementById("status-dot"),"#5bdfb0");
  document.getElementById("rescan-btn").classList.remove("hidden");
  document.getElementById("header-status-text").textContent=`run #${runCount} — score ${report.overall_score}`;
  setDotColor(document.getElementById("header-dot"),"#5bdfb0");
  setDotColor(document.getElementById("log-dot"),"#9b6dff");
  addLog("Audit complete — request another anytime.","system");
}


// ═══════════════════════════════════════════════════════════════
// FIX PROMPT GENERATION
// ═══════════════════════════════════════════════════════════════
function buildFixContext() {
  const issues = allIssues;
  const findings = staticFindings || [];
  const data = siteData || {};
  const headers = data?.headers || {};

  const issuesByCategory = {};
  issues.forEach(i => {
    if (!issuesByCategory[i.category]) issuesByCategory[i.category] = [];
    issuesByCategory[i.category].push(i);
  });

  const failedStatic = findings.filter(f => !f.pass);
  const passedStatic = findings.filter(f => f.pass);

  const context = {
    url: currentUrl,
    score: report?.overall_score || 0,
    health: report?.health || "unknown",
    mode: currentMode,
    httpStatus: data?.status,
    responseTime: data?.responseTime,
    https: data?.url?.startsWith("https"),
    securityHeaders: {
      hsts: !!headers["strict-transport-security"],
      csp: !!headers["content-security-policy"],
      xFrameOptions: !!headers["x-frame-options"],
      xContentType: !!headers["x-content-type-options"],
      referrerPolicy: !!headers["referrer-policy"],
      permissionsPolicy: !!headers["permissions-policy"],
    },
    robotsTxt: data?.robotsTxt,
    sitemapXml: data?.sitemapXml,
    totalIssues: issues.length,
    criticalCount: issues.filter(i => i.severity === "critical").length,
    highCount: issues.filter(i => i.severity === "high").length,
    issuesByCategory,
    failedChecks: failedStatic.map(f => ({ check: f.check, value: f.value, detail: f.detail })),
    passedChecks: passedStatic.map(f => f.check),
  };

  return context;
}

function buildClaudePrompt(ctx) {
  const issueLines = Object.entries(ctx.issuesByCategory).map(([cat, issues]) => {
    return `\n### ${cat}\n` + issues.map(i =>
      `- [${i.severity.toUpperCase()}] ${i.title}\n  Problem: ${i.description}\n  Fix: ${i.fix}`
    ).join("\n");
  }).join("\n");

  const failedLines = ctx.failedChecks.map(f =>
    `- ${f.check}: ${f.detail} (current value: ${f.value})`
  ).join("\n");

  return `<context>
You are reviewing a QA audit of ${ctx.url}. The site currently scores ${ctx.score}/100 (${ctx.health}). Your job is to produce exact, production-ready fixes that will bring the score to 100/100.
</context>

<audit_results>
URL: ${ctx.url}
Current score: ${ctx.score}/100
Health: ${ctx.health}
HTTP status: ${ctx.httpStatus} | Response time: ${ctx.responseTime}ms
HTTPS: ${ctx.https ? "✓ enabled" : "✗ NOT enabled — critical"}
Total issues: ${ctx.totalIssues} (${ctx.criticalCount} critical, ${ctx.highCount} high)

Security headers status:
- HSTS: ${ctx.securityHeaders.hsts ? "✓ present" : "✗ MISSING"}
- CSP: ${ctx.securityHeaders.csp ? "✓ present" : "✗ MISSING"}
- X-Frame-Options: ${ctx.securityHeaders.xFrameOptions ? "✓ present" : "✗ MISSING"}
- X-Content-Type-Options: ${ctx.securityHeaders.xContentType ? "✓ present" : "✗ MISSING"}
- Referrer-Policy: ${ctx.securityHeaders.referrerPolicy ? "✓ present" : "✗ MISSING"}
- Permissions-Policy: ${ctx.securityHeaders.permissionsPolicy ? "✓ present" : "✗ MISSING"}

robots.txt: ${ctx.robotsTxt ? "✓ found" : "✗ missing"}
sitemap.xml: ${ctx.sitemapXml ? "✓ found" : "✗ missing"}
</audit_results>

<issues_to_fix>
${issueLines}
</issues_to_fix>

<static_analysis_failures>
${failedLines || "None"}
</static_analysis_failures>

<passing_checks>
${ctx.passedChecks.join(", ") || "None"}
</passing_checks>

<instructions>
For EACH issue above, provide the exact fix. Format your response as:

## Fix 1: [Issue Title]
**Why it matters:** [one sentence]
**Exact fix:**
\`\`\`[language]
[production-ready code or configuration]
\`\`\`
**Verification:** How to confirm this fix brings this check to 100%

After all fixes, provide:
## Complete <head> section
A fully corrected <head> block incorporating all meta, SEO, and security fixes.

## Server configuration
Any required server headers (nginx/Apache/Netlify/Vercel config) to add missing security headers.

The goal is a site that scores 100/100 when re-scanned by ShieldQA. Be exact. No placeholders. Real values where possible.
</instructions>`;
}

function buildGPTPrompt(ctx) {
  const issueLines = Object.entries(ctx.issuesByCategory).map(([cat, issues]) => {
    return `\n**${cat}**\n` + issues.map(i =>
      `• [${i.severity.toUpperCase()}] ${i.title}: ${i.description}`
    ).join("\n");
  }).join("\n");

  const failedLines = ctx.failedChecks.map(f =>
    `• ${f.check}: ${f.detail}`
  ).join("\n");

  return `You are a web developer helping fix a website that scored ${ctx.score}/100 on a QA audit. I need you to fix every issue so it scores 100/100.

**Site:** ${ctx.url}
**Current Score:** ${ctx.score}/100 | Health: ${ctx.health}
**Total Issues:** ${ctx.totalIssues} (${ctx.criticalCount} critical, ${ctx.highCount} high)

---

**ISSUES FOUND:**
${issueLines}

---

**FAILED STATIC CHECKS:**
${failedLines || "None"}

---

**SECURITY HEADERS STATUS:**
${Object.entries(ctx.securityHeaders).map(([k, v]) => `• ${k}: ${v ? "✓ OK" : "✗ MISSING — needs to be added"}`).join("\n")}

**Other:**
• robots.txt: ${ctx.robotsTxt ? "✓ exists" : "✗ missing — needs to be created"}
• sitemap.xml: ${ctx.sitemapXml ? "✓ exists" : "✗ missing — needs to be created"}

---

**WHAT I NEED FROM YOU:**

For each issue, give me:
1. The exact code fix (no placeholders, real values)
2. Where in the codebase to put it
3. How to verify it's fixed

Then provide:
- A complete corrected \`<head>\` section with all SEO, meta, and social tags fixed
- The exact server config (nginx / Apache / Netlify \`_headers\` file / \`netlify.toml\` / \`vercel.json\`) to add all missing security headers
- A corrected \`robots.txt\` and \`sitemap.xml\` if missing

Be specific. Use real code. The goal is a 100/100 rescan.`;
}

async function generateFixPrompts() {
  const fixContent = document.getElementById("fix-content");
  const fixPlaceholder = document.getElementById("fix-placeholder");

  fixPlaceholder.style.display = "none";
  fixContent.classList.remove("hidden");
  fixContent.innerHTML = `<div class="fix-generating">${pdotHtml("#9b6dff", 8)}<span>Building fix prompts from scan data...</span></div>`;

  // Switch to fix tab
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById("tab-fix-btn").classList.add("active");
  document.getElementById("panel-fix").classList.add("active");

  await new Promise(r => setTimeout(r, 400));

  const ctx = buildFixContext();
  const claudePrompt = buildClaudePrompt(ctx);
  const gptPrompt = buildGPTPrompt(ctx);

  const severityColor = { critical: "#ff5b7f", high: "#ff8c5b", medium: "#f5d442", low: "#5bdfb0", info: "#7eb3ff" };

  fixContent.innerHTML = `
    <div class="fix-header">
      <div class="fix-header-bar"></div>
      <div class="fix-header-title">Fix Prompts — ${ctx.totalIssues} issues · Score ${ctx.score}/100</div>
      <div class="fix-header-sub">
        Copy either prompt below and paste it directly into Claude or ChatGPT. Each prompt contains your full audit results and exact instructions to return production-ready fixes that bring your site to 100/100.
      </div>
    </div>

    <div class="fix-issue-summary">
      <div class="fix-issue-summary-title">ISSUES INCLUDED IN PROMPTS</div>
      ${allIssues.map(i => {
        const c = severityColor[i.severity] || "#7eb3ff";
        return `<div class="fix-issue-row"><span style="font-size:9px;color:${c};border:1px solid ${c}30;padding:1px 6px;border-radius:3px;flex-shrink:0;">${i.severity.toUpperCase()}</span><span style="color:var(--text-second);">${i.category}</span><span style="color:var(--text-primary);flex:1;">${i.title}</span></div>`;
      }).join("") || '<div style="color:var(--text-dim);font-size:11px;padding:4px 0;">No issues found — site is clean!</div>'}
    </div>

    <div class="fix-cards">
      <div class="fix-card fix-card-claude">
        <div class="fix-card-head">
          <div class="fix-card-label">
            <div class="fix-card-logo">⬡</div>
            <div>
              <div class="fix-card-name">Claude prompt</div>
              <div class="fix-card-desc">Optimized for claude.ai — uses XML tags, structured context, explicit verification steps</div>
            </div>
          </div>
          <button class="fix-copy-btn" id="copy-claude-btn" onclick="copyPrompt('claude')">Copy prompt</button>
        </div>
        <div class="fix-prompt-box" id="claude-prompt-box">${claudePrompt.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
        <button class="fix-open-btn" onclick="openInClaude()">↗ Open claude.ai</button>
      </div>

      <div class="fix-card fix-card-gpt">
        <div class="fix-card-head">
          <div class="fix-card-label">
            <div class="fix-card-logo">◎</div>
            <div>
              <div class="fix-card-name">ChatGPT prompt</div>
              <div class="fix-card-desc">Optimized for ChatGPT — clean markdown format, numbered fixes, explicit deliverables</div>
            </div>
          </div>
          <button class="fix-copy-btn" id="copy-gpt-btn" onclick="copyPrompt('gpt')">Copy prompt</button>
        </div>
        <div class="fix-prompt-box" id="gpt-prompt-box">${gptPrompt.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
        <button class="fix-open-btn" onclick="openInGPT()">↗ Open ChatGPT</button>
      </div>
    </div>
  `;

  // Store raw prompts for copying
  window._claudePrompt = claudePrompt;
  window._gptPrompt = gptPrompt;
}

function copyPrompt(type) {
  const text = type === "claude" ? window._claudePrompt : window._gptPrompt;
  const btnId = type === "claude" ? "copy-claude-btn" : "copy-gpt-btn";
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById(btnId);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = "✓ Copied!";
      btn.classList.add("copied");
      setTimeout(() => { btn.textContent = orig; btn.classList.remove("copied"); }, 2000);
    }
  }).catch(() => {
    // Fallback for browsers that block clipboard
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    const btn = document.getElementById(btnId);
    if (btn) { btn.textContent = "✓ Copied!"; setTimeout(() => btn.textContent = "Copy prompt", 2000); }
  });
}

function openInClaude() {
  window.open("https://claude.ai", "_blank");
}

function openInGPT() {
  window.open("https://chat.openai.com", "_blank");
}

document.querySelectorAll(".tab-btn").forEach(btn=>{btn.addEventListener("click",()=>{
  if(btn.dataset.tab==="fix"&&phase==="done"&&allIssues!==undefined){generateFixPrompts();return;}
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p=>p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("panel-"+btn.dataset.tab).classList.add("active");
});});
document.getElementById("run-btn").addEventListener("click",()=>{
  let v=document.getElementById("url-input").value.trim();
  if(!v)return;
  if(!v.startsWith("http"))v="https://"+v;
  if(!currentUser){
    // Invite-only / login-required: queue the requested audit and prompt sign-in
    pendingScanUrl=v;pendingScanMode=currentMode;
    openAuth("login");
    return;
  }
  startScan(v,currentMode);
});
document.getElementById("url-input").addEventListener("keydown",e=>{if(e.key==="Enter")document.getElementById("run-btn").click();});
document.getElementById("rescan-btn").addEventListener("click",()=>{startScan(currentUrl,currentMode);});
document.getElementById("done-btn").addEventListener("click",()=>{running=false;phase="idle";document.getElementById("dashboard").classList.add("hidden");document.getElementById("hero").classList.remove("hidden");document.getElementById("hero").style.animation="fadeIn .4s ease";document.getElementById("header-status").classList.add("hidden");document.getElementById("fetch-status").style.display="none";document.getElementById("url-input").value="";});

// ═══════════════════════════════════════════════════════════════
// TOAST  ·  wires up the previously-unused #error-toast element
// ═══════════════════════════════════════════════════════════════
let _toastTimer=null;
function showToast(msg){
  const t=document.getElementById("error-toast");
  if(!t)return;
  t.textContent=msg;t.style.display="block";
  clearTimeout(_toastTimer);
  _toastTimer=setTimeout(()=>{t.style.display="none";},4200);
}

// ═══════════════════════════════════════════════════════════════
// AUTH + SAVED SCANS  ·  custom UI on the Netlify Identity (GoTrue) API
// A themed modal talks straight to /.netlify/identity (no widget, no
// iframe). Scan history lives in user_metadata, capped to 20 scans.
// ═══════════════════════════════════════════════════════════════
const IDENTITY_URL="/.netlify/identity";
const SESSION_KEY="shieldqa_session";
let currentUser=null;
let pendingScanUrl=null,pendingScanMode="both";
let identityDisableSignup=false;
// Invite tokens require token + password in a single /verify call (GoTrue requirement).
// We stash the token here until the user submits their new password.
let pendingInviteToken=null;
// Full-page gate state
let gateTab="login",gateBusy=false,gateError="",gateMessage="";
const gateValues={email:"",password:"",rName:"",rEmail:"",rReason:""};
let authState="login",authError="",authMessage="",authBusy=false;
const authValues={email:"",password:"",name:""};

function getAudits(){
  return (currentUser&&currentUser.user_metadata&&currentUser.user_metadata.audits)||[];
}

function displayName(){
  const fn=((currentUser&&currentUser.user_metadata&&currentUser.user_metadata.full_name)||"").trim();
  if(fn)return fn.split(/\s+/)[0];
  return (currentUser&&currentUser.email)||"account";
}
function renderAccount(){
  const el=document.getElementById("account");
  if(el){
    if(currentUser){
      const email=currentUser.email||"account";
      el.innerHTML=`<button class="acct-btn" id="acct-toggle" title="${email}"><span class="acct-dot">◆</span><span class="acct-label">${displayName()}</span></button>`;
      document.getElementById("acct-toggle").addEventListener("click",e=>{e.stopPropagation();toggleAcctMenu();});
    }else{
      el.innerHTML="";  // gate page handles sign-in; header button hidden when logged out
    }
  }
  applyAuthGate();
}

// ── Full-page auth gate ──────────────────────────────────────────
function needsWelcome(){
  return !!(currentUser && !(currentUser.user_metadata && currentUser.user_metadata.onboarded));
}

function applyAuthGate(){
  const gate=document.getElementById("gate-page");
  const wel=document.getElementById("welcome-page");
  if(!gate)return;
  if(!currentUser){
    // Not signed in → gate
    gate.classList.remove("hidden");
    if(wel)wel.classList.add("hidden");
    document.body.style.overflow="hidden";
    gateError="";gateMessage="";gateBusy=false;
    renderGate();
  }else if(needsWelcome()){
    // Signed in, first time → orientation
    gate.classList.add("hidden");
    if(wel){wel.classList.remove("hidden");renderWelcome();}
    document.body.style.overflow="hidden";
  }else{
    // Fully onboarded → reveal app
    gate.classList.add("hidden");
    if(wel)wel.classList.add("hidden");
    document.body.style.overflow="";
  }
}

function renderWelcome(){
  const c=document.getElementById("welcome-content");
  if(!c)return;
  const existing=(currentUser&&currentUser.user_metadata&&currentUser.user_metadata.full_name)||"";
  c.innerHTML=`
    <div class="gate-field"><label class="gate-label" for="welcome-name">What should we call you? <span class="gate-opt">(optional)</span></label>
      <input class="gate-input" id="welcome-name" type="text" placeholder="Your name" value="${existing}" autocomplete="name"></div>
    <div id="welcome-err"></div>
    <button class="gate-submit" id="welcome-submit">Get started →</button>`;
  const inp=document.getElementById("welcome-name");
  const btn=document.getElementById("welcome-submit");
  btn.addEventListener("click",completeWelcome);
  inp.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();completeWelcome();}});
  setTimeout(()=>inp.focus(),60);
}

async function completeWelcome(){
  const btn=document.getElementById("welcome-submit");
  const errEl=document.getElementById("welcome-err");
  const name=(document.getElementById("welcome-name").value||"").trim();
  if(btn){btn.disabled=true;btn.textContent="Setting up…";}
  if(errEl)errEl.innerHTML="";
  try{
    const next=Object.assign({},currentUser.user_metadata||{},{onboarded:true});
    if(name)next.full_name=name;
    await updateUserData(next);
    currentUser.user_metadata=next;
    renderAccount();  // triggers applyAuthGate → hides welcome, reveals app
    // Honor any audit the user queued before signing in
    if(pendingScanUrl){
      const u=pendingScanUrl,m=pendingScanMode;pendingScanUrl=null;
      showToast(name?`Welcome, ${name.split(/\s+/)[0]} — starting your audit.`:"Welcome aboard — starting your audit.");
      startScan(u,m);
    }else{
      showToast(name?`Welcome, ${name.split(/\s+/)[0]}.`:"Welcome to ShieldQA.");
    }
  }catch(e){
    if(errEl)errEl.innerHTML=`<div class="auth-msg auth-err">Couldn't save: ${e.message}</div>`;
    if(btn){btn.disabled=false;btn.textContent="Get started →";}
  }
}

function setGateTab(tab){
  gateTab=tab;gateError="";gateMessage="";
  document.querySelectorAll(".gate-tab").forEach(b=>b.classList.toggle("active",b.dataset.gateTab===tab));
  renderGate();
}

function captureGateInputs(){
  const m=id=>document.getElementById(id);
  if(m("gate-email"))gateValues.email=m("gate-email").value;
  if(m("gate-password"))gateValues.password=m("gate-password").value;
  if(m("gate-rname"))gateValues.rName=m("gate-rname").value;
  if(m("gate-remail"))gateValues.rEmail=m("gate-remail").value;
  if(m("gate-rreason"))gateValues.rReason=m("gate-rreason").value;
}

function setGateBusy(b){
  gateBusy=b;
  const btn=document.querySelector("#gate-content .gate-submit");
  if(btn){btn.disabled=b;
    if(b){btn.dataset.label=btn.textContent;btn.textContent="Working…";}
    else if(btn.dataset.label)btn.textContent=btn.dataset.label;}
}

function renderGate(){
  const c=document.getElementById("gate-content");
  if(!c)return;
  const err=gateError?`<div class="auth-msg auth-err">${gateError}</div>`:"";
  const ok=gateMessage?`<div class="auth-msg auth-ok">${gateMessage}</div>`:"";
  if(gateTab==="login"){
    c.innerHTML=`<div class="gate-hint">Log in to continue</div>${err}${ok}
      <div class="gate-field"><label class="gate-label" for="gate-email">Email</label>
        <input class="gate-input" id="gate-email" type="email" value="${gateValues.email||""}" autocomplete="email"></div>
      <div class="gate-field"><label class="gate-label" for="gate-password">Password</label>
        <input class="gate-input" id="gate-password" type="password" autocomplete="current-password"></div>
      <button class="gate-submit" data-gate-act="login">Log in</button>
      <button class="gate-link" data-gate-act="forgot">Forgot password?</button>`;
  }else{
    c.innerHTML=`<div class="gate-hint">Request access</div>
      <p class="gate-desc">ShieldQA is invite-only. Send a request and you'll get an invitation by email if approved.</p>${err}${ok}
      <div class="gate-field"><label class="gate-label" for="gate-rname">Your name</label>
        <input class="gate-input" id="gate-rname" type="text" placeholder="Jane Doe" value="${gateValues.rName||""}" autocomplete="name"></div>
      <div class="gate-field"><label class="gate-label" for="gate-remail">Your email</label>
        <input class="gate-input" id="gate-remail" type="email" placeholder="you@example.com" value="${gateValues.rEmail||""}" autocomplete="email"></div>
      <div class="gate-field"><label class="gate-label" for="gate-rreason">Why do you need access? <span class="gate-opt">(optional)</span></label>
        <textarea class="gate-input" id="gate-rreason" placeholder="e.g. I run a SaaS and want to audit my site weekly.">${gateValues.rReason||""}</textarea></div>
      <button class="gate-submit" data-gate-act="request">Send request</button>`;
  }
  c.querySelectorAll("[data-gate-act]").forEach(b=>b.addEventListener("click",()=>gateAction(b.dataset.gateAct)));
  c.querySelectorAll(".gate-input").forEach(i=>i.addEventListener("keydown",e=>{
    if(e.key==="Enter"&&i.tagName!=="TEXTAREA"){e.preventDefault();const s=c.querySelector(".gate-submit");if(s)s.click();}
  }));
}

async function gateAction(act){
  if(act==="forgot"){captureGateInputs();openAuth("forgot");return;}
  if(gateBusy)return;
  captureGateInputs();
  gateError="";gateMessage="";
  try{
    if(act==="login"){
      const email=(gateValues.email||"").trim(),password=gateValues.password||"";
      if(!email||!password)throw new Error("Enter your email and password.");
      setGateBusy(true);
      await identityLogin(email,password);
      gateValues.password="";
      // If first-time user, completeWelcome will trigger any pending scan after orientation
      if(needsWelcome()){
        // welcome screen will appear automatically via applyAuthGate
      }else if(pendingScanUrl){
        const u=pendingScanUrl,m=pendingScanMode;pendingScanUrl=null;
        showToast("Signed in — starting your audit.");
        startScan(u,m);
      }else showToast("Signed in.");
    }else if(act==="request"){
      const name=(gateValues.rName||"").trim();
      const email=(gateValues.rEmail||"").trim();
      const reason=(gateValues.rReason||"").trim();
      if(!name)throw new Error("Please enter your name.");
      if(!email||!/.+@.+\..+/.test(email))throw new Error("Please enter a valid email.");
      setGateBusy(true);
      await submitAccessRequest(name,email,reason);
      gateValues.rName="";gateValues.rEmail="";gateValues.rReason="";
      gateMessage="Request received. We'll email you an invitation if approved.";
      gateBusy=false;renderGate();
    }
  }catch(e){
    gateError=e.message;gateBusy=false;renderGate();
  }
}

async function submitAccessRequest(name,email,reason){
  const body=new URLSearchParams({"form-name":"access-request",name,email,reason:reason||""}).toString();
  const res=await fetch("/",{method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},body});
  if(!res.ok)throw new Error("Couldn't send request ("+res.status+"). Please try again later.");
}


function toggleAcctMenu(){
  const el=document.getElementById("account");
  if(el.querySelector(".acct-pop")){el.querySelector(".acct-pop").remove();return;}
  const pop=document.createElement("div");pop.className="acct-pop";
  const n=getAudits().length;
  pop.innerHTML=`<div class="acct-pop-head">${n} SAVED AUDIT${n===1?"":"S"}</div>`;
  const hasName=!!((currentUser&&currentUser.user_metadata&&currentUser.user_metadata.full_name)||"").trim();
  const nameBtn=document.createElement("button");
  nameBtn.textContent=hasName?"✎ Edit name":"✎ Set your name";
  nameBtn.addEventListener("click",()=>openAuth("name"));
  const out=document.createElement("button");out.textContent="↩ Sign out";
  out.addEventListener("click",()=>identityLogout());
  pop.appendChild(nameBtn);
  pop.appendChild(out);
  el.appendChild(pop);
}
document.addEventListener("click",()=>{const p=document.querySelector(".acct-pop");if(p)p.remove();});

function activateTab(name){
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
  document.querySelectorAll(".tab-panel").forEach(p=>p.classList.toggle("active",p.id==="panel-"+name));
}

// Re-display a previously saved audit without re-running it.
function loadSavedAudit(a){
  if(!a||!a.report){showToast("This audit's details weren't saved — re-run it.");return;}
  running=false;phase="done";
  currentUrl=a.url;currentMode=a.mode||"both";
  report=a.report;
  allIssues=(a.issues||[]).map(i=>Object.assign({},i));
  siteData=null;staticFindings=[];
  activeTasks=ALL_TASKS[currentMode]||ALL_TASKS.both;

  document.getElementById("hero").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  document.getElementById("fetch-status").style.display="none";
  document.getElementById("status-url").textContent=a.url;
  document.getElementById("run-label").textContent=`saved · ${a.date}`;
  document.getElementById("status-mode-badge").textContent=currentMode.toUpperCase()+" SCAN";
  setDotColor(document.getElementById("status-dot"),"#9b6dff");
  const hs=document.getElementById("header-status");hs.classList.remove("hidden");hs.style.display="flex";
  document.getElementById("header-status-text").textContent=`saved audit — score ${report.overall_score}`;
  setDotColor(document.getElementById("header-dot"),"#9b6dff");
  document.getElementById("rescan-btn").classList.remove("hidden");

  renderReport();renderIssues();updateMetrics();

  // rebuild task cards from the saved issues, grouped by category
  buildTaskGrid();
  activeTasks.forEach(task=>{
    const ti=allIssues.filter(i=>i.category===task.label);
    const sev=ti.some(i=>i.severity==="critical"||i.severity==="high");
    renderTaskCard(task,{phase:"done",result:{
      status:ti.length===0?"pass":sev?"fail":"warning",issues:ti,
      summary:ti.length?`${ti.length} issue(s) — from saved audit`:"No issues recorded"}});
  });

  document.getElementById("raw-box").innerHTML=`<div style="color:var(--text-dim);text-align:center;padding:40px;line-height:1.6;">Live HTTP data isn't kept for saved audits.<br>Use Rescan to capture fresh raw data.</div>`;
  const si=document.getElementById("stack-info");
  if(a.stack){si.classList.remove("hidden");si.innerHTML=`<span class="stack-lead">Detected stack</span><span class="stack-chip primary">${a.stack}</span>`;}
  else si.classList.add("hidden");
  document.getElementById("fix-placeholder").style.display="block";
  document.getElementById("fix-content").classList.add("hidden");
  document.getElementById("fix-content").innerHTML="";

  document.getElementById("logs-inner").innerHTML="";
  addLog(`Loaded saved audit — ${a.url}`,"system");
  addLog(`Audited ${a.date} · score ${report.overall_score}/100 · ${allIssues.length} issues`,"info");
  addLog("Raw HTTP logs aren't stored for saved audits. Rescan for live data.","data");
  activateTab("report");
}

function renderRecentScans(){
  const el=document.getElementById("recent-scans");
  if(!el)return;
  const audits=getAudits();
  if(!currentUser||audits.length===0){el.classList.add("hidden");el.innerHTML="";return;}
  el.classList.remove("hidden");
  let h=`<div class="rs-title">Your recent audits · ${audits.length} saved · tap to view</div>`;
  audits.forEach((a,idx)=>{
    const sc=(a.report&&a.report.overall_score)||0;
    const c=sc>=80?"#5bdfb0":sc>=60?"#f5d442":"#ff5b7f";
    let delta="";
    const older=audits.slice(idx+1).find(o=>o.url===a.url&&o.report);
    if(older){
      const d=sc-(older.report.overall_score||0);
      if(d!==0)delta=`<span class="rs-delta" style="color:${d>0?"#5bdfb0":"#ff5b7f"};">${d>0?"▲":"▼"}${Math.abs(d)}</span>`;
    }
    h+=`<div class="rs-item" data-idx="${idx}"><span class="rs-url">${a.url}</span>${delta}<span class="rs-score" style="color:${c};background:${c}18;border:1px solid ${c}35;">${sc}</span><span class="rs-date">${a.date}</span></div>`;
  });
  el.innerHTML=h;
  el.querySelectorAll(".rs-item").forEach(it=>it.addEventListener("click",()=>{
    loadSavedAudit(getAudits()[parseInt(it.dataset.idx,10)]);
  }));
}

function trimText(s,n){s=String(s||"");return s.length>n?s.slice(0,n-1)+"…":s;}

async function saveScan(url,mode){
  if(!currentUser||!report)return;
  try{
    const issues=allIssues.slice(0,24).map(i=>({
      severity:i.severity,title:trimText(i.title,120),category:i.category,source:i.source,
      description:trimText(i.description,200),reproduction:trimText(i.reproduction,200),fix:trimText(i.fix,200)}));
    const snap={url,mode,date:new Date().toISOString().slice(0,10),ts:Date.now(),
      stack:stackSummary(detectedStack),
      report:{overall_score:report.overall_score,grade:report.grade,health:report.health,
        headline:report.headline,breakdown:report.breakdown,
        top_priority:report.top_priority,next_run_recommendation:report.next_run_recommendation,
        positive_findings:(report.positive_findings||[]).slice(0,6),engines:report.engines||["AI"]},
      issues};
    const next=[snap,...getAudits()].slice(0,10);
    await updateUserData(Object.assign({},currentUser.user_metadata||{},{audits:next}));
    addLog(`Audit saved to your account (${next.length} stored)`,"success");
    renderRecentScans();
  }catch(e){
    addLog("Could not save audit: "+e.message,"warn");
  }
}

// ── GoTrue REST helpers ──
async function gotrue(path,{method="GET",body,token,form=false}={}){
  const headers={};let payload;
  if(form){headers["Content-Type"]="application/x-www-form-urlencoded";payload=new URLSearchParams(body).toString();}
  else if(body){headers["Content-Type"]="application/json";payload=JSON.stringify(body);}
  if(token)headers["Authorization"]="Bearer "+token;
  let res;
  try{res=await fetch(IDENTITY_URL+path,{method,headers,body:payload});}
  catch{throw new Error("Network error reaching the Identity service.");}
  const data=await res.json().catch(()=>({}));
  if(!res.ok){
    if(res.status===404)throw new Error("Identity isn't enabled on this site yet.");
    throw new Error(data.error_description||data.msg||data.error||`Request failed (${res.status})`);
  }
  return data;
}

// ── session storage ──
function saveSession(tok){
  const s={access_token:tok.access_token,refresh_token:tok.refresh_token,
    expires_at:Date.now()+((tok.expires_in||3600)*1000)};
  try{localStorage.setItem(SESSION_KEY,JSON.stringify(s));}catch{}
  return s;
}
function getSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||"null");}catch{return null;}}
function clearSession(){try{localStorage.removeItem(SESSION_KEY);}catch{}}

async function getValidToken(){
  let s=getSession();
  if(!s||!s.access_token)return null;
  if(Date.now()<s.expires_at-60000)return s.access_token;
  if(!s.refresh_token){clearSession();return null;}
  try{
    const tok=await gotrue("/token",{method:"POST",form:true,
      body:{grant_type:"refresh_token",refresh_token:s.refresh_token}});
    return saveSession(tok).access_token;
  }catch{clearSession();return null;}
}

function normalizeUser(u){
  return{email:u.email,user_metadata:u.user_metadata||{},app_metadata:u.app_metadata||{}};
}
async function loadIdentitySettings(){
  try{
    const r=await fetch(IDENTITY_URL+"/settings");
    if(r.ok){const s=await r.json();identityDisableSignup=!!s.disable_signup;}
  }catch{/* Identity not enabled or unreachable — leave defaults */}
}

async function loadUserFromSession(){
  const token=await getValidToken();
  if(!token){currentUser=null;renderAccount();renderRecentScans();return;}
  try{currentUser=normalizeUser(await gotrue("/user",{token}));}
  catch{clearSession();currentUser=null;}
  renderAccount();renderRecentScans();
}

// ── auth actions ──
async function identityLogin(email,password){
  // Step 1: exchange credentials for a token
  const tok=await gotrue("/token",{method:"POST",form:true,
    body:{grant_type:"password",username:email,password}});
  saveSession(tok);
  // Step 2: verify the token actually works by fetching the user.
  // If this fails we MUST throw — otherwise a 400 here would silently leave the
  // session cleared while the caller shows a misleading "Signed in" toast.
  try{
    currentUser=normalizeUser(await gotrue("/user",{token:tok.access_token}));
  }catch(e){
    clearSession();currentUser=null;renderAccount();
    throw new Error("Couldn't load your account ("+e.message+"). Try signing in again.");
  }
  renderAccount();renderRecentScans();
}
async function identitySignup(email,password,name){
  const body={email,password};
  if(name)body.data={full_name:name};
  return gotrue("/signup",{method:"POST",body});
}
async function identityRecover(email){
  return gotrue("/recover",{method:"POST",body:{email}});
}
async function identitySetPassword(password){
  // Invite acceptance: token + password go to /verify together. GoTrue creates
  // the session in the response.
  if(pendingInviteToken){
    const tok=pendingInviteToken;
    pendingInviteToken=null;
    saveSession(await gotrue("/verify",{method:"POST",
      body:{type:"signup",token:tok,password}}));
    await loadUserFromSession();
    return;
  }
  // Recovery flow: page load already exchanged the recovery token for a session;
  // we just update the password on that session.
  const token=await getValidToken();
  if(!token)throw new Error("Session expired — please use the email link again.");
  currentUser=normalizeUser(await gotrue("/user",{method:"PUT",token,body:{password}}));
  renderAccount();renderRecentScans();
}
async function identityLogout(){
  const s=getSession();
  if(s&&s.access_token){try{await gotrue("/logout",{method:"POST",token:s.access_token});}catch{}}
  clearSession();currentUser=null;
  renderAccount();renderRecentScans();showToast("Signed out.");
}
async function updateUserData(data){
  const token=await getValidToken();
  if(!token)throw new Error("Not signed in");
  currentUser=normalizeUser(await gotrue("/user",{method:"PUT",token,body:{data}}));
  return currentUser;
}

// ── themed modal ──
function openAuth(state){
  authState=state||"login";authError="";authMessage="";authBusy=false;
  renderAuthForm();
  document.getElementById("auth-overlay").classList.remove("hidden");
}
function closeAuth(){
  document.getElementById("auth-overlay").classList.add("hidden");
  authError="";authMessage="";
}
function captureAuthInputs(){
  const e=document.getElementById("auth-email"),p=document.getElementById("auth-password"),
        nm=document.getElementById("auth-name");
  if(e)authValues.email=e.value;
  if(p)authValues.password=p.value;
  if(nm)authValues.name=nm.value;
}
function setAuthState(s){captureAuthInputs();authState=s;authError="";authMessage="";renderAuthForm();}
function setAuthBusy(b){
  authBusy=b;
  const btn=document.querySelector("#auth-body .auth-submit");
  if(btn){btn.disabled=b;
    if(b){btn.dataset.label=btn.textContent;btn.textContent="Working…";}
    else if(btn.dataset.label)btn.textContent=btn.dataset.label;}
}

function renderAuthForm(){
  const body=document.getElementById("auth-body");
  if(!body)return;
  const err=authError?`<div class="auth-msg auth-err">${authError}</div>`:"";
  const ok=authMessage?`<div class="auth-msg auth-ok">${authMessage}</div>`:"";
  const ev=authValues.email||"";
  if(authState==="message"){
    body.innerHTML=`<div class="auth-title">Almost there</div>${ok}${err}
      <button class="auth-link" data-act="to-login">← Back to log in</button>`;
  }else if(authState==="forgot"){
    body.innerHTML=`<div class="auth-title">Reset your password</div>
      <p class="auth-sub">Enter your email and we'll send a reset link.</p>${err}${ok}
      <input class="auth-input" id="auth-email" type="email" placeholder="Email" value="${ev}" autocomplete="email">
      <button class="auth-submit" data-act="recover">Send reset link</button>
      <button class="auth-link" data-act="to-login">← Back to log in</button>`;
  }else if(authState==="recover"||authState==="invite"){
    body.innerHTML=`<div class="auth-title">${authState==="invite"?"Set your password":"Choose a new password"}</div>
      <p class="auth-sub">Pick a password to ${authState==="invite"?"activate":"recover"} your account.</p>${err}${ok}
      <input class="auth-input" id="auth-password" type="password" placeholder="New password" autocomplete="new-password">
      <button class="auth-submit" data-act="setpw">Save password</button>`;
  }else if(authState==="name"){
    const cur=((currentUser&&currentUser.user_metadata&&currentUser.user_metadata.full_name)||"");
    body.innerHTML=`<div class="auth-title">Your name</div>
      <p class="auth-sub">Shown in the header instead of your email.</p>${err}${ok}
      <input class="auth-input" id="auth-name" type="text" placeholder="e.g. Timofey" value="${cur}" autocomplete="given-name">
      <button class="auth-submit" data-act="setname">Save name</button>
      <button class="auth-link" data-act="close-modal">Cancel</button>`;
  }else{
    const isLogin=authState!=="signup";
    const nv=authValues.name||"";
    const inviteOnly=identityDisableSignup;
    // In invite-only mode, hide the Sign-up tab entirely and force the form into login
    const showLoginForm=isLogin||inviteOnly;
    body.innerHTML=`
      ${inviteOnly?`<div class="auth-title" style="margin-bottom:8px;">Log in</div>
        <p class="auth-sub" style="margin-bottom:14px;">ShieldQA is invite-only. Have an invite link? Click it from your inbox to set your password.</p>`
      :`<div class="auth-tabs">
        <button class="auth-tab${isLogin?"":" active"}" data-act="to-signup">Sign up</button>
        <button class="auth-tab${isLogin?" active":""}" data-act="to-login">Log in</button>
      </div>`}${err}${ok}
      ${showLoginForm?'':`<input class="auth-input" id="auth-name" type="text" placeholder="Name (optional)" value="${nv}" autocomplete="given-name">`}
      <input class="auth-input" id="auth-email" type="email" placeholder="Email" value="${ev}" autocomplete="email">
      <input class="auth-input" id="auth-password" type="password" placeholder="Password" autocomplete="${showLoginForm?"current-password":"new-password"}">
      <button class="auth-submit" data-act="${showLoginForm?"login":"signup"}">${showLoginForm?"Log in":"Create account"}</button>
      ${showLoginForm?'<button class="auth-link" data-act="to-forgot">Forgot password?</button>'
              :'<p class="auth-fineprint">Your scan history will be saved privately to this account.</p>'}`;
  }
  body.querySelectorAll("[data-act]").forEach(b=>b.addEventListener("click",()=>authAction(b.dataset.act)));
  body.querySelectorAll(".auth-input").forEach(i=>i.addEventListener("keydown",e=>{
    if(e.key==="Enter"){e.preventDefault();const s=body.querySelector(".auth-submit");if(s)s.click();}
  }));
}

async function authAction(act){
  if(act==="to-login"){setAuthState("login");return;}
  if(act==="to-signup"){setAuthState("signup");return;}
  if(act==="to-forgot"){setAuthState("forgot");return;}
  if(act==="close-modal"){closeAuth();return;}
  if(authBusy)return;
  captureAuthInputs();
  const email=(authValues.email||"").trim(),password=authValues.password||"";
  authError="";authMessage="";
  try{
    if(act==="login"){
      if(!email||!password)throw new Error("Enter your email and password.");
      setAuthBusy(true);
      await identityLogin(email,password);
      authValues.email="";authValues.password="";closeAuth();
      if(needsWelcome()){
        // welcome screen appears automatically via applyAuthGate
      }else if(pendingScanUrl){
        const u=pendingScanUrl,m=pendingScanMode;pendingScanUrl=null;
        showToast("Signed in — starting your audit.");
        startScan(u,m);
      }else showToast("Signed in.");
    }else if(act==="signup"){
      if(!email||!password)throw new Error("Enter your email and password.");
      if(password.length<6)throw new Error("Password must be at least 6 characters.");
      setAuthBusy(true);
      const u=await identitySignup(email,password,(authValues.name||"").trim());
      authValues.password="";authValues.name="";
      if(u&&u.confirmed_at){
        authMessage="Account created — you can log in now.";authState="login";
      }else{
        authMessage="Account created! Check your email for a confirmation link, then log in.";
        authState="message";
      }
      authBusy=false;renderAuthForm();
    }else if(act==="recover"){
      if(!email)throw new Error("Enter your email address.");
      setAuthBusy(true);
      await identityRecover(email);
      authMessage="If that email has an account, a reset link is on its way.";
      authState="message";authBusy=false;renderAuthForm();
    }else if(act==="setpw"){
      if(!password||password.length<6)throw new Error("Password must be at least 6 characters.");
      setAuthBusy(true);
      await identitySetPassword(password);
      authValues.password="";closeAuth();showToast("Password saved — you're signed in.");
    }else if(act==="setname"){
      const name=(authValues.name||"").trim();
      setAuthBusy(true);
      await updateUserData(Object.assign({},currentUser.user_metadata||{},{full_name:name}));
      renderAccount();closeAuth();
      showToast(name?("Name saved — hi, "+name.split(/\s+/)[0]+"."):"Name cleared.");
    }
  }catch(e){
    authError=e.message;authBusy=false;renderAuthForm();
  }
}

// ── handle email-link returns (#confirmation_token / #recovery_token / #invite_token) ──
function clearHash(){
  try{history.replaceState(null,"",location.pathname+location.search);}
  catch{location.hash="";}
}
async function handleAuthHash(){
  const h=location.hash||"";
  const grab=re=>{const m=h.match(re);return m?m[1]:null;};
  if(h.indexOf("error=")>-1){clearHash();showToast("Authentication link error. Please try again.");return false;}
  const conf=grab(/confirmation_token=([^&]+)/),
        rec=grab(/recovery_token=([^&]+)/),
        inv=grab(/invite_token=([^&]+)/)||grab(/invitation_token=([^&]+)/);
  try{
    if(conf){
      try{
        saveSession(await gotrue("/verify",{method:"POST",body:{type:"signup",token:conf}}));
        clearHash();await loadUserFromSession();showToast("Email confirmed — you're signed in.");
        return true;
      }catch(e){
        // Netlify uses confirmation_token in the URL for BOTH email confirmations and
        // invitations. GoTrue distinguishes them server-side: if the user was invited
        // (has invited_at but no password), /verify rejects with "Invited users must
        // specify a password". Recover by treating the token as an invite — stash it
        // and prompt for a password instead of toasting an error.
        if(/specify a password|password.{0,8}required/i.test(e.message)){
          pendingInviteToken=conf;
          clearHash();openAuth("invite");return true;
        }
        throw e;
      }
    }
    if(rec){
      saveSession(await gotrue("/verify",{method:"POST",body:{type:"recovery",token:rec}}));
      clearHash();openAuth("recover");return true;
    }
    if(inv){
      // Explicit invite_token in URL — stash, prompt for password, verify on submit.
      pendingInviteToken=inv;
      clearHash();openAuth("invite");return true;
    }
  }catch(e){
    clearHash();showToast("Could not complete that link: "+e.message);
  }
  return false;
}

async function initAuth(){
  const overlay=document.getElementById("auth-overlay");
  document.getElementById("auth-close").addEventListener("click",closeAuth);
  overlay.addEventListener("click",e=>{if(e.target===overlay)closeAuth();});
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&!overlay.classList.contains("hidden"))closeAuth();
  });
  // Wire gate tab buttons + render initial gate content immediately
  document.querySelectorAll(".gate-tab").forEach(b=>b.addEventListener("click",()=>setGateTab(b.dataset.gateTab)));
  renderGate();
  await loadIdentitySettings();
  const handled=await handleAuthHash();
  if(!handled)await loadUserFromSession();
}
initAuth();
