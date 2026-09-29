import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StepPricing } from '../../src/sidepanel/components/steps/StepPricing.tsx';
import { createInitialSheet, createAuditedField } from '../../src/core/schema/product.ts';
import '../../src/styles/globals.css';
// Isolated visual fixture. This page is not an extension entry point or a production API fallback.
(window as any).chrome = { runtime: { async sendMessage({action,payload}: any) {
  if (action === 'status') return {ok:true,configured:true,connected:true,sellerId:'CONTA-TESTE'};
  if (action === 'pricing-categories') return {ok:true,categories:[{id:'MLB1234',name:'Copos'}]};
  if (action === 'pricing-quote') return {ok:true,request:payload,sellerId:'CONTA-TESTE',queriedAt:new Date().toISOString(),source:'mercadolivre_api',saleFee:Math.round((payload.price * .16 + 3)*100)/100,fixedFee:3,percentageFee:16,shippingCost:8};
  throw new Error('Ação não disponível nesta demonstração local.');
} } };
function Preview() {
  const [sheet,setSheet]=useState(() => {const s=createInitialSheet();s.title=createAuditedField('Copo azul · TESTE');s.costPrice=createAuditedField(20);s.categoryIdML=createAuditedField('MLB1234');s.mlCalculator={categoryId:'MLB1234',price:100,listingType:'gold_pro',shippingMode:'me2',logisticType:'xd_drop_off',condition:'new',freeShipping:false,dimensions:'10x15x20,500',cost:20,taxPercent:6,packaging:2,otherCosts:3,manualShipping:null};return s;});
  const [saved,setSaved]=useState(false);
  return <main style={{maxWidth:390}} className="mx-auto max-w-[390px] p-4 bg-slate-50 min-h-screen"><p className="mb-4 rounded-lg bg-amber-100 p-3 text-xs">TESTE VISUAL LOCAL · respostas simuladas · não conectado ao ML real</p>{saved && <p role="status">Preço aplicado: {sheet.suggestedSalePrice.value} · {sheet.mlCalculator?.listingType}</p>}<StepPricing sheet={sheet} onUpdateSheet={setSheet} onPrev={()=>{}} onFinish={()=>setSaved(true)} /></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
