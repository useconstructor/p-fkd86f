import { z } from 'zod';
export const currencies = ['EUR','USD','MXN','ARS','COP','CLP','PEN','UYU','BOB','BRL','CRC','DOP','GTQ','HNL','NIO','PAB','PYG','VES','GBP','CHF','CAD','JPY','KWD','BHD','TND'] as const;
export const currencyNames = new Intl.DisplayNames('es', {type:'currency'});
export function precision(currency: string) { return new Intl.NumberFormat('es', {style:'currency',currency}).resolvedOptions().maximumFractionDigits ?? 2; }
export function money(minor: number, currency: string) { return new Intl.NumberFormat('es-ES',{style:'currency',currency,currencyDisplay:'code',minimumFractionDigits:precision(currency),maximumFractionDigits:precision(currency)}).format(minor / 10 ** precision(currency)); }
export function decimal(minor:number,currency:string) { const p=precision(currency); const s=String(minor).padStart(p+1,'0'); return p ? `${s.slice(0,-p)},${s.slice(-p).replace(/0+$/, '').padEnd(Math.min(p,2),'0')}` : s; }
export function localToday() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Introduce una fecha válida.').refine(s=>{const [y,m,d]=s.split('-').map(Number); const dt=new Date(0);dt.setFullYear(y,m-1,d);return y>=1900&&y<=9999&&dt.getFullYear()===y&&dt.getMonth()===m-1&&dt.getDate()===d;},'Introduce una fecha de calendario válida (1900–9999).');
export const monthSchema=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(s=>Number(s.slice(0,4))>=1900&&Number(s.slice(0,4))<=9999);
export const expenseSchema=z.object({concept:z.string().trim().min(1,'Escribe un concepto.').max(120,'Máximo 120 caracteres.'),amount:z.string().trim().regex(/^\d+([.,]\d{1,2})?$/,'Usa un importe positivo con hasta dos decimales.'),date:dateSchema,category_id:z.string().min(1,'Selecciona una categoría.'),note:z.string().trim().max(500,'Máximo 500 caracteres.').default('')}).strict();
export const categorySchema=z.object({name:z.string().trim().min(1,'Escribe un nombre.').max(60,'Máximo 60 caracteres.')}).strict();
export const categoryPatchSchema=z.object({name:categorySchema.shape.name.optional(),archived:z.boolean().optional()}).strict().refine(v=>v.name!==undefined||v.archived!==undefined,'Indica un cambio.');
export const settingsSchema=z.object({currency:z.enum(currencies)}).strict();
export function parseMinor(amount:string,currency:string) { const [whole,fraction='']=amount.replace(',','.').split('.');const p=precision(currency); if(fraction.length>p&&/[1-9]/.test(fraction.slice(p))) throw new Error('Esta moneda no admite esa fracción.'); const minor=BigInt(whole)*10n**BigInt(p)+BigInt((fraction.slice(0,p).padEnd(p,'0'))||'0');if(minor<=0n||minor>999999999999n)throw new Error('El importe debe ser positivo y menor que el límite permitido.');return Number(minor); }
export type Category={id:string;name:string;archived:number};
export type Expense={id:string;concept:string;amount_minor:number;date:string;category_id:string;category_name:string;archived:number;note:string};
export type Monthly={total:number;count:number;categories:{id:string;name:string;total:number;count:number}[]};
