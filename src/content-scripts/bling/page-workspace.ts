import type { ContextualActionType, TabContextUiState } from '../../shared/tab-context-contracts.ts';
import { findProductTable, extractProductIdFromRow } from './product-list-cost-injector.ts';
import { findBlingProductInput } from './form-assistant.ts';
export const workspaceStyles = `
:host{all:initial;display:block;width:100%;margin:18px 0 24px;font:13px/1.5 Inter,system-ui,sans-serif;color:#17243a;letter-spacing:normal}
*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #74a7ff;outline-offset:2px}button:disabled{opacity:.45;cursor:not-allowed}[hidden]{display:none!important}
.shell{background:#fff;border:1px solid #dce4ef;border-radius:18px;overflow:hidden;box-shadow:0 4px 16px #193a6810}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:13px 20px;background:#102e61;color:white}.brand{display:flex;align-items:center;gap:10px;font-weight:750;font-size:14px}.symbol{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:#ffffff;padding:2px;box-shadow:0 1px 3px rgba(0,0,0,.15);font-size:18px}.tag{font-size:10px;font-weight:600;color:#c6d9f7;background:#ffffff12;border:1px solid #ffffff20;padding:4px 8px;border-radius:5px}.top button{border:0;background:#ffffff14;color:white;border-radius:7px;padding:5px 11px}.hero{padding:22px 24px 18px;display:flex;justify-content:space-between;align-items:center;gap:20px}.eyebrow{font-size:10px;font-weight:700;letter-spacing:.1em;color:#6a7f9d;text-transform:uppercase}h2{font-size:23px;line-height:1.25;letter-spacing:-.025em;margin:5px 0 8px;font-weight:730}p{margin:0;color:#66768d;font-size:12px}.primary,.secondary{padding:10px 15px;border-radius:9px;font-weight:650;white-space:nowrap}.primary{background:#2467dc;color:white;border:1px solid #2467dc;box-shadow:0 3px 6px #2467dc20}.primary:hover{background:#1958c2}.secondary{background:white;border:1px solid #dce4ef;color:#345073}.secondary:hover{background:#f2f6fd}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid #e8edf5;border-bottom:1px solid #e8edf5;margin:0 24px}.stat{padding:16px 18px 16px 0}.stat+.stat{border-left:1px solid #e8edf5;padding-left:20px}.stat small{display:block;font-size:11px;color:#6b7e96}.stat strong{display:block;font-size:23px;letter-spacing:-.02em;margin-top:2px;font-weight:700}.stat span{font-size:10px;color:#8492a6}.content{padding:20px 24px}.split{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(240px,1fr);gap:24px}.section-title{display:flex;align-items:center;justify-content:space-between;margin:0 0 12px;font-size:13px;font-weight:700}.count{font-size:10px;border-radius:5px;padding:3px 7px;background:#eef4fe;color:#2467dc}.fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.field{text-align:left;border:1px solid #e5eaf2;background:#fafbfd;border-radius:9px;padding:11px 12px;min-width:0}.field small{display:block;font-size:10px;color:#75859b;margin-bottom:4px}.field strong{display:block;font-size:12px;color:#223b5b;overflow-wrap:anywhere}.field.missing{border-color:#f1dfb6;background:#fffcf5}.field.missing strong{color:#a66a13}.field.unavailable{background:#f4f5f7}.next{background:#f2f6ff;border:1px solid #dfe9fc;border-radius:12px;padding:17px}.next h3{font-size:14px;margin:0 0 8px}.next p{line-height:1.65}.next button{margin-top:14px;width:100%}.steps{margin:16px 0 0;padding:0;list-style:none;color:#60728b;display:grid;gap:10px;font-size:11px}.steps b{display:inline-grid;place-items:center;background:#e3ecfc;color:#2467dc;border-radius:50%;width:20px;height:20px;margin-right:7px}.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}.toolbar input{min-width:180px;flex:1;border:1px solid #dce4ef;border-radius:9px;background:#fafbfd;padding:10px 13px;color:#17243a}.filter{border:1px solid #dce4ef;background:white;border-radius:8px;padding:8px 12px;color:#64748b;font-size:12px}.filter[aria-pressed=true]{background:#eaf2ff;border-color:#b9d2ff;color:#205cbe}.products{display:grid;gap:7px;max-height:320px;overflow:auto}.row{display:grid;grid-template-columns:minmax(0,1fr) 120px auto;align-items:center;gap:16px;padding:13px 14px;border:1px solid #e6ebf2;border-radius:10px;background:#fff}.row:hover{background:#fafcff;border-color:#bfd4f6}.row strong{display:block;font-size:12px}.row small{color:#7e8ca1;font-size:10px}.cost{font-weight:700;font-size:12px;color:#25634f}.cost small{display:block;font-weight:400}.row button{font-size:11px;padding:7px 10px}.footer{display:flex;justify-content:space-between;gap:12px;align-items:center;background:#fafbfd;border-top:1px solid #e8edf5;padding:11px 24px;color:#8290a3;font-size:10px}.footer button{border:0;background:transparent;color:#3168bb;font-size:11px}.empty{padding:22px;text-align:center;background:#f7f9fc;border-radius:10px;color:#66768d}.notice{margin-top:12px;font-size:11px;color:#3866a8}.collapsed .body{display:none}
@media(max-width:760px){.split{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column}.hero,.content{padding:16px}.stats{margin:0 16px}.row{grid-template-columns:minmax(0,1fr) auto}.row .cost{grid-column:1}.row button{grid-column:2;grid-row:1/3}.stat strong{font-size:19px}.top{padding:12px 16px}.tag{display:none}}
`;
type Mode = 'list' | 'form';
type Field = {
    label: string;
    input: HTMLInputElement | HTMLTextAreaElement | null;
};
const ID = 'paulifest-page-workspace';
export class BlingPageWorkspace {
    private host: HTMLElement | null = null;
    private shadow: ShadowRoot | null = null;
    private observer: MutationObserver | null = null;
    private timer: number | undefined;
    private active = false;
    private mode: Mode = 'form';
    private productId: string | undefined;
    private contextUrl = '';
    private ui: TabContextUiState | null = null;
    private signature = '';
    private search = '';
    private onlyMissing = false;
    private readonly inputListener = () => this.refresh();
    constructor(private onAction: (action: ContextualActionType) => void, private onMount?: () => void) { }
    start(mode: Mode, productId?: string): void {
        if (this.productId !== productId || this.contextUrl !== location.href) {
            this.ui = null;
            this.signature = '';
        }
        this.productId = productId;
        this.contextUrl = location.href;
        if (this.observer && this.mode === mode) {
            this.refresh();
            return;
        }
        this.destroy();
        this.active = true;
        this.mode = mode;
        this.signature = '';
        this.refresh();
        this.observer = new MutationObserver(() => { window.clearTimeout(this.timer); this.timer = window.setTimeout(() => this.refresh(), 180); });
        this.observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener('input', this.inputListener);
        document.addEventListener('change', this.inputListener);
    }
    update(ui: TabContextUiState): void { this.ui = ui; if (this.active)
        this.refresh(); }
    destroy(): void {
        this.active = false;
        this.observer?.disconnect();
        this.observer = null;
        window.clearTimeout(this.timer);
        document.removeEventListener('input', this.inputListener);
        document.removeEventListener('change', this.inputListener);
        this.host?.remove();
        this.host = null;
        this.shadow = null;
        this.signature = '';
        this.ui = null;
    }
    private fields(): Field[] {
        const get = (selector: string) => document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
        return [{ label: 'Nome', input: findBlingProductInput('name') }, { label: 'SKU', input: findBlingProductInput('sku') }, { label: 'EAN / GTIN', input: findBlingProductInput('ean') },
            { label: 'Marca', input: get('input#marca,input[name="marca"]') }, { label: 'NCM', input: get('input#ncm,input[name="ncm"]') },
            { label: 'Descrição', input: get('textarea#descricaoComplementar,textarea[name="descricaoComplementar"]') }];
    }
    private mount(anchor: Element): void {
        if (this.host?.isConnected)
            return;
        document.getElementById(ID)?.remove();
        this.host = document.createElement('div');
        this.host.id = ID;
        this.shadow = this.host.attachShadow({ mode: 'open' });
        const iconUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL) ? chrome.runtime.getURL('icons/logo.png') : '/icons/logo.png';
        this.shadow.innerHTML = `<style>${workspaceStyles}</style><section class="shell" aria-label="Central Copilot"><header class="top"><div class="brand"><span class="symbol"><img src="${iconUrl}" alt="" style="width:22px;height:22px;object-fit:contain;display:block" /></span> Paulifest Copilot <span class="tag">DENTRO DO BLING</span></div><button id="collapse" aria-expanded="true">Recolher</button></header><div class="body"><div class="hero"><div><div class="eyebrow" id="eyebrow"></div><h2 id="title"></h2><p id="subtitle"></p></div><button id="open" class="primary">Abrir ficha no painel lateral ↗</button></div><div class="stats" id="stats"></div><div class="content" id="content"></div><footer class="footer"><span>Dados da página e consultas do Copilot · nenhuma alteração é salva automaticamente</span><button id="refresh">Atualizar leitura</button></footer></div></section>`;
        anchor.parentElement?.insertBefore(this.host, anchor);
        this.el('collapse').onclick = () => { const shell = this.shadow!.querySelector('.shell')!; const collapsed = shell.classList.toggle('collapsed'); this.el('collapse').textContent = collapsed ? 'Expandir' : 'Recolher'; this.el('collapse').setAttribute('aria-expanded', String(!collapsed)); };
        this.el('open').onclick = () => this.onAction('open_in_copilot');
        this.el('refresh').onclick = () => { this.signature = ''; this.refresh(); };
        this.signature = '';
        this.onMount?.();
    }
    private el(id: string): HTMLElement { return this.shadow!.getElementById(id)!; }
    private stats(entries: [
        string,
        string,
        string
    ][]): void {
        this.el('stats').replaceChildren(...entries.map(([label, value, note]) => {
            const node = document.createElement('div');
            node.className = 'stat';
            for (const [tag, text] of [['small', label], ['strong', value], ['span', note]]) {
                const child = document.createElement(tag);
                child.textContent = text;
                node.append(child);
            }
            return node;
        }));
    }
    private refresh(): void {
        if (this.mode === 'list') {
            this.renderList();
            return;
        }
        const fields = this.fields().map(field => ({ ...field, input: field.input?.getClientRects().length ? field.input : null })), name = fields[0].input;
        if (!name) {
            this.host?.remove();
            return;
        }
        this.mount(name.closest('form') || name.closest('.form-group,.field,.control-group') || name);
        const qv = this.ui?.quickView?.productId === this.productId ? this.ui?.quickView : null;
        const tools = document.getElementById('paulifest-form-assistant');
        if (tools && tools.parentElement !== this.host) {
            tools.slot = 'tools';
            this.host!.append(tools);
        }
        const signature = JSON.stringify([fields.map(f => [f.label, f.input?.value, f.input?.disabled]), qv, this.ui?.quickViewLoading, this.ui?.quickViewError, this.ui?.canImport]);
        if (signature === this.signature)
            return;
        this.signature = signature;
        const known = fields.filter(f => f.input), filled = known.filter(f => f.input!.value.trim()), missing = known.filter(f => !f.input!.value.trim());
        this.el('open').textContent = 'Abrir ficha no painel lateral ↗';
        this.el('eyebrow').textContent = 'Central do produto';
        this.el('title').textContent = name.value.trim() || 'Vamos preparar seu produto';
        this.el('subtitle').textContent = 'Confira o cadastro, resolva o que falta e continue até o anúncio.';
        const money = (value: number | null | undefined) => value == null ? 'Não informado' : value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        this.stats([['Campos preenchidos', `${filled.length} / ${known.length}`, 'Presença de dados, sem validação fiscal'], ['Custo do produto', this.ui?.quickViewLoading ? 'Carregando…' : this.ui?.quickViewError ? 'Indisponível' : money(qv?.costPrice), 'Consulta do Bling'], ['Estoque disponível', this.ui?.quickViewLoading ? 'Carregando…' : this.ui?.quickViewError ? 'Indisponível' : qv?.stockInfo ? String(qv.stockInfo.virtualTotal) : 'Não informado', 'Saldo virtual retornado pelo Bling']]);
        this.el('content').innerHTML = '<div class="split"><div><div class="section-title">Confira sua ficha <span class="count">CLIQUE PARA EDITAR NO BLING</span></div><div class="fields" id="fields"></div></div><aside class="next"><h3 id="next-title"></h3><p id="next-help"></p><button id="next" class="primary"></button><ol class="steps"><li><b>1</b> Confira os dados do cadastro</li><li><b>2</b> Revise conteúdo, fotos e preço no painel</li><li><b>3</b> Prepare e valide o anúncio</li></ol></aside></div><div style="margin-top:16px"><slot name="tools"></slot></div><p class="notice" id="notice" role="status"></p>';
        for (const field of fields) {
            const button = document.createElement('button');
            const value = field.input?.value.trim();
            button.type = 'button';
            button.className = 'field' + (!field.input ? ' unavailable' : !value ? ' missing' : '');
            button.disabled = !field.input || field.input.disabled || field.input.readOnly;
            const label = document.createElement('small');
            label.textContent = field.label;
            const text = document.createElement('strong');
            text.textContent = !field.input ? 'Campo não localizado' : value ? (value.length > 85 ? value.slice(0, 85) + '…' : value) : '＋ Preencher no cadastro';
            button.append(label, text);
            button.onclick = () => { field.input?.scrollIntoView({ block: 'center', behavior: 'smooth' }); field.input?.focus({ preventScroll: true }); };
            this.el('fields').append(button);
        }
        this.el('next-title').textContent = missing.length ? `${missing.length} campo(s) para conferir` : 'Dados visíveis preenchidos';
        this.el('next-help').textContent = missing.length ? 'Complete os campos úteis ao seu produto. Dados presentes ainda precisam ser revisados antes de anunciar.' : 'Continue no painel lateral para revisar a ficha completa, imagens, preço e requisitos do Mercado Livre.';
        const firstEditable = missing.find(field => !field.input!.disabled && !field.input!.readOnly);
        const next = this.el('next');
        next.textContent = firstEditable ? 'Ir ao primeiro campo vazio →' : 'Continuar no painel lateral →';
        next.onclick = () => { if (firstEditable) {
            firstEditable.input!.scrollIntoView({ block: 'center', behavior: 'smooth' });
            firstEditable.input!.focus({ preventScroll: true });
        }
        else
            this.onAction('open_in_copilot'); };
        if (fields.some(f => !f.input))
            this.el('notice').textContent = 'Alguns campos não estão visíveis nesta tela. Abra as seções do cadastro para conferi-los.';
    }
    private renderList(): void {
        const table = findProductTable();
        if (!table) {
            this.host?.remove();
            return;
        }
        this.mount(table);
        const headers = Array.from(table.querySelectorAll('thead th,thead td')).map(h => h.textContent?.trim().toLowerCase() || '');
        const nameIndex = headers.findIndex(h => /^(descrição|nome|produto|descrição do produto)$/.test(h));
        const skuIndex = headers.findIndex(h => /^(sku|código|codigo)$/.test(h));
        const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>('tbody tr')).map(row => {
            const id = extractProductIdFromRow(row);
            const link = row.querySelector<HTMLAnchorElement>('a[href*="#edit/"],a[href*="/editar/"],a[href*="#editar/"]');
            return { row, id, name: (nameIndex >= 0 ? row.cells[nameIndex]?.textContent : link?.textContent)?.trim() || `Produto #${id}`, sku: skuIndex >= 0 ? row.cells[skuIndex]?.textContent?.trim() || '' : '', cost: row.querySelector('.paulifest-cost-text')?.textContent?.trim() || 'Aguardando consulta' };
        }).filter(r => r.id);
        const signature = JSON.stringify(rows.map(({ id, name, sku, cost }) => ({ id, name, sku, cost })));
        if (signature === this.signature)
            return;
        this.signature = signature;
        this.el('open').textContent = 'Abrir painel lateral ↗';
        this.el('eyebrow').textContent = 'Visão da página atual';
        this.el('title').textContent = 'Seu catálogo, mais fácil de conferir';
        this.el('subtitle').textContent = 'Encontre um produto e acompanhe os custos consultados sem sair desta lista.';
        this.stats([['Produtos carregados', String(rows.length), 'Somente as linhas desta página'], ['Custos disponíveis', String(rows.filter(r => r.cost.startsWith('R$')).length), 'Inclui custo zero informado'], ['Sem custo informado', String(rows.filter(r => r.cost === '-').length), 'Consultas pendentes não entram neste total']]);
        const previousSearch = this.shadow?.activeElement as HTMLInputElement | null;
        const restoreSearch = previousSearch?.id === 'search', caret = previousSearch?.selectionStart;
        this.el('content').innerHTML = '<div class="toolbar"><input id="search" placeholder="Buscar por nome, SKU ou ID nesta página" aria-label="Buscar produtos nesta página"><button class="filter" id="all">Todos</button><button class="filter" id="missing">Sem custo</button></div><div class="products" id="products"></div>';
        const render = () => {
            this.el('all').setAttribute('aria-pressed', String(!this.onlyMissing));
            this.el('missing').setAttribute('aria-pressed', String(this.onlyMissing));
            this.el('products').replaceChildren();
            const result = rows.filter(r => (!this.onlyMissing || r.cost === '-') && `${r.name} ${r.sku} ${r.id}`.toLocaleLowerCase('pt-BR').includes(this.search.toLocaleLowerCase('pt-BR')));
            for (const entry of result) {
                const node = document.createElement('div');
                node.className = 'row';
                const info = document.createElement('div');
                const title = document.createElement('strong');
                title.textContent = entry.name;
                const sub = document.createElement('small');
                sub.textContent = `${entry.sku ? 'SKU ' + entry.sku + ' · ' : ''}Bling #${entry.id}`;
                info.append(title, sub);
                const cost = document.createElement('div');
                cost.className = 'cost';
                const label = document.createElement('small');
                label.textContent = 'Custo';
                cost.append(label, document.createTextNode(entry.cost === '-' ? 'Não informado' : entry.cost));
                const button = document.createElement('button');
                button.className = 'secondary';
                button.textContent = 'Localizar na lista ↓';
                button.onclick = () => { entry.row.scrollIntoView({ block: 'center', behavior: 'smooth' }); entry.row.animate([{ backgroundColor: '#dceaff' }, { backgroundColor: 'transparent' }], { duration: 1800 }); };
                node.append(info, cost, button);
                this.el('products').append(node);
            }
            if (!result.length) {
                const empty = document.createElement('div');
                empty.className = 'empty';
                empty.textContent = 'Nenhum produto corresponde ao filtro nesta página.';
                this.el('products').append(empty);
            }
        };
        const search = this.el('search') as HTMLInputElement;
        search.value = this.search;
        search.oninput = () => { this.search = search.value; render(); };
        this.el('all').onclick = () => { this.onlyMissing = false; render(); };
        this.el('missing').onclick = () => { this.onlyMissing = true; render(); };
        render();
        if (restoreSearch) {
            search.focus({ preventScroll: true });
            if (caret != null)
                search.setSelectionRange(caret, caret);
        }
    }
}
