/* BORDER BLITZ V6.0 — real-time provincial armies, independent economy per region.
   Rendering/UI do not alter authoritative simulation. */
(function(root){
'use strict';
const W=1000,H=720;
const TYPES={
 attack:{name:'Bastion',cost:135,icon:'⚔',description:'+40 % de force pour les troupes envoyées depuis cette région'},
 income:{name:'Atelier',cost:125,icon:'✦',description:'+8 points générés par seconde dans cette région'},
 reserve:{name:'Entrepôt',cost:105,icon:'▣',description:'+260 points de réserve dans cette région'}
};
const PALETTE=['#50d4f5','#f5966c','#b49afa','#f3c86c','#6ddbb5','#e18cc8','#78aaff','#c8dd85','#f3a674','#77d8d4'];
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
   this.seed=Number.isFinite(+opts.seed)?(+opts.seed>>>0):82513;
   this.random=rng(this.seed^0xa8b2d9c1);
   this.zones=makeMap(this.zoneCount,this.seed);
   for(const z of this.zones){
     z.points=Math.round(65+this.random()*62+Math.sqrt(z.area)*.10);
     z.building=null;z.owner=-1;z.flash=-1000;
   }
   this.players=Array.from({length:this.playerCount},(_,id)=>({
     id,name:id?'Royaume '+(id+1):'Vous',color:PALETTE[id],
     ai:id!==0,thinking:.8+this.random()*1.7
   }));
   // Écarter les capitales pour éviter un avantage aléatoire au départ.
   const starts=[this.nearestCenter()];
   while(starts.length<this.playerCount){
     let best=-1,distance=-1;
     for(const z of this.zones)if(!starts.includes(z.id)){
       let nearest=Infinity;
       for(const i of starts){
         const anchor=this.zones[i];
         const sq=(z.cx-anchor.cx)**2+(z.cy-anchor.cy)**2;
         if(sq<nearest)nearest=sq;
       }
       if(nearest>distance){distance=nearest;best=z.id;}
     }
     if(best<0)throw Error('Placements impossibles');
     starts.push(best);
   }
   for(let id=0;id<starts.length;id++){
     const z=this.zones[starts[id]];
     z.owner=id;z.points=id===0?225:200;z.building=null;
   }
   this.elapsed=0;this.active=true;this.flights=[];this.events=[];
   this.nextFlightId=1;this.totalSends=0;this.totalCaptures=0;this.totalBuilds=0;
   this.arrivedPackets=0;this.totalReinforcements=0;
   this.notice(this.zoneCount+' régions · '+this.playerCount+' royaumes. Fais glisser une région vers une autre pour envoyer des troupes.');
 }
 nearestCenter(){
   let pick=0,best=Infinity;
   for(const z of this.zones){
     const d=(z.cx-W/2)**2+(z.cy-H/2)**2;
     if(d<best){pick=z.id;best=d;}
   }
   return pick;
 }
 notice(message){
   this.events.unshift(message);
   if(this.events.length>6)this.events.length=6;
 }
 zoneRate(zone){
   return zone.owner<0?0:3.1+(zone.building==='income'?8:0);
 }
 zoneCapacity(zone){
   return zone.owner<0?0:280+(zone.building==='reserve'?260:0);
 }
 owned(owner){return this.zones.filter(z=>z.owner===owner);}
 stats(owner){
   const zones=this.owned(owner),buildings={attack:0,income:0,reserve:0};
   let stored=0,income=0,capacity=0;
   for(const z of zones){
     stored+=z.points;income+=this.zoneRate(z);capacity+=this.zoneCapacity(z);
     if(z.building)buildings[z.building]++;
   }
   return {zones:zones.length,stored,income,capacity,buildings};
 }
 canBuild(owner,id,type){
   const z=this.zones[id],t=TYPES[type];
   return !!(this.active&&this.players[owner]&&z&&t&&z.owner===owner&&!z.building&&z.points>=t.cost);
 }
 build(owner,id,type){
   if(!this.canBuild(owner,id,type))return false;
   const z=this.zones[id];
   z.points-=TYPES[type].cost;
   z.building=type;this.totalBuilds++;
   if(owner===0)this.notice(TYPES[type].name+' construit en région '+(id+1)+'.');
   return true;
 }
 canSend(owner,from,to,pct){
   const a=this.zones[from],b=this.zones[to],n=Number(pct);
   return !!(this.active&&this.players[owner]&&a&&b&&a.owner===owner&&a.id!==b.id&&
     Number.isFinite(n)&&n>=1&&n<=100&&Math.floor(a.points*n/100)>=12);
 }
 send(owner,from,to,pct){
   if(!this.canSend(owner,from,to,pct))return false;
   const a=this.zones[from],b=this.zones[to],amount=Math.floor(a.points*Number(pct)/100);
   if(amount<12)return false;
   a.points=Math.max(0,a.points-amount);
   const dx=b.cx-a.cx,dy=b.cy-a.cy,distance=Math.hypot(dx,dy);
   // Propagation successive des escouades comme dans un jeu de rush RTS.
   const count=Math.max(3,Math.min(15,Math.ceil(amount/18)));
   const rate=a.building==='attack'?1.4:1;
   const base=Math.floor(amount/count),extra=amount%count;
   const travel=.32+distance/365;
   const packets=[];
   for(let i=0;i<count;i++){
     const troops=base+(i<extra?1:0);
     const launch=this.elapsed+i*.065;
     packets.push({troops,launch,arrival:launch+travel,done:false});
   }
   const flight={id:this.nextFlightId++,owner,from,to,amount,rate,packets,
     createdAt:this.elapsed,travel,firstArrival:packets[0].arrival,
     finalArrival:packets[packets.length-1].arrival};
   this.flights.push(flight);this.totalSends++;
   if(owner===0){
     const friendly=b.owner===owner?'Renforts':'Assaut';
     this.notice(friendly+' : région '+(from+1)+' → '+(to+1)+' ('+amount+' soldats).');
   }
   return flight;
 }
 hit(flight,packet){
   const zone=this.zones[flight.to],sourceOwner=flight.owner;
   if(!this.players[sourceOwner]||packet.troops<=0)return;
   this.arrivedPackets++;
   if(zone.owner===sourceOwner){
     zone.points=Math.min(this.zoneCapacity(zone),zone.points+packet.troops);
     this.totalReinforcements+=packet.troops;
     return;
   }
   const strength=packet.troops*flight.rate;
   if(strength<zone.points){
     zone.points-=strength;
     return;
   }
   const old=zone.owner;
   const surplus=Math.max(0,strength-zone.points);
   zone.owner=sourceOwner;zone.building=null;
   zone.points=Math.max(1,Math.min(this.zoneCapacity(zone),surplus));
   zone.flash=this.elapsed;
   this.totalCaptures++;
   if(sourceOwner===0)this.notice('Région '+(zone.id+1)+' conquise !');
   if(old===0)this.notice('Ta région '+(zone.id+1)+' a été prise !');
 }
 tick(dt){
   if(!this.active)return;
   dt=Math.min(.10,Math.max(0,Number(dt)||0));
   this.elapsed+=dt;
   for(const z of this.zones)if(z.owner>=0)
     z.points=Math.min(this.zoneCapacity(z),z.points+this.zoneRate(z)*dt);
   const arrivals=[];
   for(const flight of this.flights)for(const pack of flight.packets){
     if(!pack.done&&pack.arrival<=this.elapsed){
       pack.done=true;arrivals.push({flight,pack});
     }
   }
   if(arrivals.length){
     arrivals.sort((a,b)=>a.pack.arrival-b.pack.arrival||a.flight.id-b.flight.id);
     for(const entry of arrivals)this.hit(entry.flight,entry.pack);
   }
   this.flights=this.flights.filter(f=>f.packets.some(p=>!p.done));
   for(const player of this.players)if(player.ai&&this.owned(player.id).length){
     player.thinking-=dt;
     if(player.thinking<=0){
       player.thinking=.95+this.random()*1.5;
       this.actAI(player.id);
     }
   }
   const alive=this.players.filter(p=>this.zones.some(z=>z.owner===p.id)).length;
   const noPlayer=!this.owned(0).length&&!this.flights.some(f=>f.owner===0);
   if(this.elapsed>=this.duration||noPlayer||(alive===1&&this.zones.every(z=>z.owner!==-1))){
     this.active=false;
   }
 }
 actAI(owner){
   const regions=this.owned(owner);
   if(!regions.length)return;
   const capable=regions.filter(z=>z.points>=50).sort((a,b)=>b.points-a.points);
   if(!capable.length)return;
   // Un peu de développement économique avant la ruée.
   const empty=regions.filter(z=>!z.building);
   const incomeCount=regions.filter(z=>z.building==='income').length;
   if(empty.length&&this.random()<.27){
     const choice=incomeCount<Math.max(1,Math.floor(regions.length/3))?'income':
       this.random()<.62?'attack':'reserve';
     const place=empty.find(z=>z.points>=TYPES[choice].cost);
     if(place&&this.build(owner,place.id,choice))return;
   }
   const source=capable[0];
   let targets=[];
   for(const zone of this.zones){
     if(zone.id===source.id)continue;
     const distance=Math.hypot(zone.cx-source.cx,zone.cy-source.cy);
     if(zone.owner===owner){
       if(zone.points<30&&source.points>105&&distance<450)
         targets.push({zone,score:10-distance*.02,reinforce:true});
       continue;
     }
     const available=source.points*.72*(source.building==='attack'?1.4:1);
     const shortage=Math.max(0,zone.points-available);
     const enemyFactor=zone.owner<0?1.2:.85;
     const score=enemyFactor*200/(70+distance*.15+zone.points*.54+shortage*1.0)+this.random()*.12;
     targets.push({zone,score,reinforce:false});
   }
   targets.sort((a,b)=>b.score-a.score);
   const dest=targets[0];
   if(!dest)return;
   const use=dest.reinforce?60:
     source.points>200?75:source.points>95?65:50;
   this.send(owner,source.id,dest.zone.id,use);
 }
 ranking(){
   return this.players.map(p=>({owner:p.id,zones:this.owned(p.id).length,
     points:Math.floor(this.stats(p.id).stored)}))
     .sort((a,b)=>b.zones-a.zones||b.points-a.points);
 }
}
root.BorderBlitzZoneCore={ZoneGame,makeMap,TYPES,PALETTE,W,H};
})(typeof window!=='undefined'?window:globalThis);
