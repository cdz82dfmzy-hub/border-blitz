/* BORDER BLITZ — Zones v5.0 | deterministic engine; no DOM dependencies */
(function(root){
'use strict';
const W=1000,H=720;
const TYPES={
  attack:{name:'Bastion',cost:140,icon:'⚔',description:'Puissance offensive : +10 % global et +30 % depuis cette zone.'},
  income:{name:'Atelier',cost:125,icon:'✦',description:'Production : +6 points par seconde.'},
  reserve:{name:'Entrepôt',cost:110,icon:'▣',description:'Réserve maximale : +300 points.'}
};
const PALETTE=['#51cffb','#ff956d','#b6a0ff','#f1cb63','#69dea7','#e78bc8','#79a8fe','#c9dd7c','#f0aa7a','#72d9d3'];
function rng(seed){let n=seed>>>0;return ()=>{n=(Math.imul(1664525,n)+1013904223)>>>0;return n/4294967296;};}
function clip(poly,a,b,c){
  if(!poly.length)return [];
  const out=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],v=a*p.x+b*p.y-c,u=a*q.x+b*q.y-c;
    if(v<=0)out.push(p);
    if((v<0&&u>0)||(v>0&&u<0)){
      const t=v/(v-u);
      out.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});
    }
  }
  return out;
}
function calcPolygon(poly){
  let cross=0,cx=0,cy=0;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],v=a.x*b.y-b.x*a.y;
    cross+=v;cx+=(a.x+b.x)*v;cy+=(a.y+b.y)*v;
  }
  return {area:Math.abs(cross)/2,x:cross?cx/(3*cross):0,y:cross?cy/(3*cross):0};
}
function makeMap(total,seed){
  const random=rng((seed^0x1f7a9bcd)>>>0);
  const columns=Math.ceil(Math.sqrt(total*W/H)),rows=Math.ceil(total/columns);
  const spaces=[];
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)spaces.push([x,y]);
  for(let i=spaces.length-1;i>0;i--){
    const j=Math.floor(random()*(i+1));[spaces[j],spaces[i]]=[spaces[i],spaces[j]];
  }
  const coords=spaces.slice(0,total).map(([x,y])=>({
    x:(x+.5+(random()-.5)*.60)*W/columns,
    y:(y+.5+(random()-.5)*.60)*H/rows
  }));
  const zones=coords.map((s,i)=>{
    let poly=[{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}];
    for(let j=0;j<total;j++)if(j!==i){
      const t=coords[j],a=2*(t.x-s.x),b=2*(t.y-s.y),c=t.x*t.x+t.y*t.y-s.x*s.x-s.y*s.y;
      poly=clip(poly,a,b,c);
      if(!poly.length)break;
    }
    const {area,x,y}=calcPolygon(poly);
    return {id:i,poly,area,cx:x,cy:y,neighbors:[],owner:-1,building:null,
      defense:Math.round(60+Math.sqrt(area)*.38+random()*40),baseDefense:0,flash:0};
  });
  for(let i=0;i<zones.length;i++){
    const p=zones[i].poly;
    for(let j=0;j<p.length;j++){
      const a=p[j],b=p[(j+1)%p.length],mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
      if(Math.hypot(a.x-b.x,a.y-b.y)<2)continue;
      const seed=coords[i],self=(mx-seed.x)**2+(my-seed.y)**2;
      let match=-1,best=2;
      for(let k=0;k<total;k++)if(k!==i){
        const other=coords[k],diff=Math.abs(self-((mx-other.x)**2+(my-other.y)**2));
        if(diff<best){best=diff;match=k;}
      }
      if(match>=0&&!zones[i].neighbors.includes(match))zones[i].neighbors.push(match);
    }
  }
  // Ensure that both sides of every shared border agree on adjacency.
  for(const z of zones)for(const n of z.neighbors)
    if(!zones[n].neighbors.includes(z.id))zones[n].neighbors.push(z.id);
  for(const z of zones){z.baseDefense=z.defense;}
  return zones;
}
class ZoneGame{
  constructor(opts={}){
    this.zoneCount=Math.max(12,Math.min(50,Math.round(+opts.zones||35)));
    this.playerCount=Math.max(2,Math.min(10,this.zoneCount,Math.round(+opts.players||6)));
    this.duration=Math.max(180,Math.min(1800,Math.round(+opts.duration||600)));
    this.seed=Number.isFinite(Number(opts.seed))?(Number(opts.seed)>>>0):82513;
    this.random=rng(this.seed^0xa8b2d9c1);
    this.zones=makeMap(this.zoneCount,this.seed);
    this.players=Array.from({length:this.playerCount},(_,id)=>({
      id,name:id===0?'Vous':'Royaume '+(id+1),color:PALETTE[id],points:id===0?250:220,
      ai:id!==0,thinking:this.random()*3+1.5,attacking:null
    }));
    const chosen=[this.nearestCenter()];
    while(chosen.length<this.playerCount){
      let winner=-1,best=-1;
      for(const z of this.zones)if(!chosen.includes(z.id)){
        const min=Math.min(...chosen.map(i=>(this.zones[i].cx-z.cx)**2+(this.zones[i].cy-z.cy)**2));
        if(min>best){best=min;winner=z.id;}
      }
      if(winner<0)throw Error('Impossible de placer tous les royaumes');
      chosen.push(winner);
    }
    chosen.forEach((i,id)=>{const z=this.zones[i];z.owner=id;z.defense=110;z.baseDefense=110;});
    this.elapsed=0;this.active=true;this.battles=[];this.events=[];
    this.totalAttacks=0;this.totalCaptures=0;this.buildCount=0;
    this.notice('Nouvelle partie : '+this.zoneCount+' régions, '+this.playerCount+' royaumes.');
  }
  nearestCenter(){
    let id=0,d=Infinity;
    for(const z of this.zones){const score=(z.cx-W/2)**2+(z.cy-H/2)**2;if(score<d){id=z.id;d=score;}}
    return id;
  }
  notice(str){this.events.unshift(str);if(this.events.length>6)this.events.length=6;}
  owned(id){return this.zones.filter(z=>z.owner===id);}
  stats(id){
    const owned=this.owned(id);
    const counts={attack:0,income:0,reserve:0};
    for(const z of owned)if(z.building)counts[z.building]++;
    return {owned:owned.length,counts,income:8+owned.length*2.5+counts.income*6,
      capacity:520+owned.length*45+counts.reserve*300,
      multiplier:1+counts.attack*.10};
  }
  adjacency(id,target){
    return this.zones[target].neighbors.filter(i=>this.zones[i].owner===id);
  }
  canBuild(owner,zone,type){
    const z=this.zones[zone],p=this.players[owner],def=TYPES[type];
    return !!(this.active&&p&&z&&def&&z.owner===owner&&!z.building&&p.points>=def.cost);
  }
  build(owner,zone,type){
    if(!this.canBuild(owner,zone,type))return false;
    const p=this.players[owner],z=this.zones[zone];
    p.points-=TYPES[type].cost;z.building=type;this.buildCount++;
    if(owner===0)this.notice(TYPES[type].name+' construit dans la région '+String(zone+1).padStart(2,'0')+'.');
    return true;
  }
  maxCommit(owner){return Math.floor(this.players[owner]?.points||0);}
  canAttack(owner,target,amount){
    const p=this.players[owner],z=this.zones[target];
    return !!(this.active&&p&&z&&z.owner!==owner&&!p.attacking&&
      this.adjacency(owner,target).length&&Number.isFinite(amount)&&amount>=15&&amount<=p.points);
  }
  attack(owner,target,amount){
    amount=Math.floor(amount);
    if(!this.canAttack(owner,target,amount))return false;
    const p=this.players[owner],zone=this.zones[target],owned=this.adjacency(owner,target);
    const stats=this.stats(owner),from=owned.sort((a,b)=>
      (this.zones[b].building==='attack')-(this.zones[a].building==='attack'))[0];
    const local=this.zones[from].building==='attack'?.30:0;
    const power=Math.floor(amount*(stats.multiplier+local));
    p.points-=amount;
    const battle={owner,target,from,amount,power,originalOwner:zone.owner,
      start:this.elapsed,remaining:1.5+Math.min(1.5,amount/800),duration:1.5+Math.min(1.5,amount/800)};
    p.attacking=battle;this.battles.push(battle);this.totalAttacks++;
    if(owner===0)this.notice('Assaut sur la région '+String(target+1).padStart(2,'0')+' : '+power+' de puissance.');
    return true;
  }
  resolve(battle){
    const p=this.players[battle.owner],z=this.zones[battle.target];
    if(p.attacking===battle)p.attacking=null;
    if(!this.active)return;
    if(z.owner!==battle.originalOwner||!this.adjacency(battle.owner,battle.target).length){
      p.points=Math.min(this.stats(battle.owner).capacity,p.points+battle.amount);
      if(battle.owner===0)this.notice('Assaut annulé : situation modifiée. Points remboursés.');
      return;
    }
    z.defense=Math.max(0,z.defense-battle.power);
    if(z.defense===0){
      const was=z.owner;z.owner=battle.owner;z.building=null;
      z.baseDefense=Math.round(80+Math.sqrt(z.area)*.24);
      z.defense=Math.min(z.baseDefense,45);
      if(was>=0){const loser=this.players[was];loser.points=Math.min(loser.points,this.stats(was).capacity);}
      z.flash=this.elapsed;this.totalCaptures++;
      if(battle.owner===0)this.notice('Région '+String(z.id+1).padStart(2,'0')+' conquise !');
      if(was===0)this.notice('Une de vos régions vient de tomber !');
    }else if(battle.owner===0)this.notice('Région '+String(z.id+1).padStart(2,'0')+' : '+z.defense+' défenses restantes.');
  }
  tick(dt){
    if(!this.active)return;
    dt=Math.min(Math.max(0,dt),.25);
    this.elapsed+=dt;
    for(const p of this.players){
      const st=this.stats(p.id);
      p.points=Math.min(st.capacity,p.points+st.income*dt);
    }
    for(const z of this.zones)if(z.owner>=0)
      z.defense=Math.min(z.baseDefense,z.defense+dt*.8);
    for(const battle of [...this.battles]){
      battle.remaining-=dt;
      if(battle.remaining<=0){
        this.battles.splice(this.battles.indexOf(battle),1);
        this.resolve(battle);
      }
    }
    for(const p of this.players)if(p.ai){
      p.thinking-=dt;
      if(p.thinking<=0){p.thinking=1.2+this.random()*1.8;this.actAI(p.id);}
    }
    if(this.elapsed>=this.duration||this.zones.every(z=>z.owner>=0&&z.owner===this.zones[0].owner)){
      this.active=false;this.battles.length=0;
      for(const p of this.players)p.attacking=null;
    }
  }
  actAI(id){
    const p=this.players[id],stats=this.stats(id);
    if(!stats.owned||p.attacking)return;
    const owned=this.owned(id);
    const empty=owned.filter(z=>!z.building);
    if(empty.length&&p.points>180){
      let desired=stats.counts.income<Math.max(1,Math.ceil(stats.owned/3))?'income':
       p.points>stats.capacity*.8&&stats.counts.reserve<2?'reserve':
       stats.counts.attack<Math.max(1,Math.floor(stats.owned/4))?'attack':null;
      if(!desired&&this.random()<.4)desired=this.random()<.5?'attack':'income';
      if(desired){
        const preferred=desired==='attack'?empty.filter(z=>z.neighbors.some(n=>this.zones[n].owner!==id)):empty;
        const place=(preferred.length?preferred:empty)[Math.floor(this.random()*(preferred.length||empty.length))];
        if(this.build(id,place.id,desired))return;
      }
    }
    const targets=[];
    for(const z of this.zones){
      if(z.owner===id||!this.adjacency(id,z.id).length)continue;
      const mult=stats.multiplier+(this.adjacency(id,z.id).some(i=>this.zones[i].building==='attack')?.30:0);
      const importance=(z.owner<0?1.3:1)+.2*this.random();
      targets.push({id:z.id,cost:z.defense/mult,score:importance/(30+z.defense)});
    }
    if(!targets.length||p.points<45)return;
    targets.sort((a,b)=>b.score-a.score);
    const target=targets[Math.floor(this.random()*Math.min(3,targets.length))];
    const amount=Math.min(Math.floor(p.points*.8),Math.max(45,Math.ceil(target.cost*1.05)));
    if(amount>=15)this.attack(id,target.id,amount);
  }
  ranking(){
    return this.players.map(p=>({owner:p.id,points:Math.floor(p.points),
      zones:this.owned(p.id).length})).sort((a,b)=>b.zones-a.zones||b.points-a.points);
  }
}
root.BorderBlitzZoneCore={ZoneGame,makeMap,TYPES,PALETTE,W,H};
})(typeof window!=='undefined'?window:globalThis);
