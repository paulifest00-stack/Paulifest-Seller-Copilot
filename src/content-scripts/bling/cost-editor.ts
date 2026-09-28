import { parseCostInput } from '../../shared/cost.ts';
export interface CostSaveResult {
    ok: boolean;
    cost?: number;
    error?: string;
    remoteUpdateMayHaveCompleted?: boolean;
}
function formatInlineBrl(cost: number | null | undefined, withSymbol = false): string {
    if (cost === null || cost === undefined) return withSymbol ? 'Definir' : '0,00';
    const num = cost.toFixed(2).replace('.', ',');
    return withSymbol ? `R$ ${num}` : num;
}
export function createCostEditor(options: {
    getCost: () => number | null;
    isCurrent: () => boolean;
    save: (value: number, expected: number | null) => Promise<CostSaveResult>;
    onSaved: (value: number) => void;
    successMessage?: string;
    prefixLabel?: string;
}): HTMLElement & { refreshDisplay?: () => void; openEditor?: () => void } {
    const isTableCell = !options.prefixLabel;
    const host = document.createElement('span') as HTMLElement & { refreshDisplay?: () => void; openEditor?: () => void };
    host.className = 'paulifest-cost-editor';
    host.setAttribute('data-stop-propagation', 'true');
    host.style.cssText = 'display:inline-flex;align-items:center;vertical-align:middle;max-width:100%;position:relative;z-index:2;';

    const wrap = document.createElement('span');
    wrap.style.cssText = `display:inline-flex;flex-direction:column;align-items:${isTableCell ? 'flex-start' : 'flex-end'};max-width:100%;`;

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.title = 'Clique para alterar o preço de custo aqui na lista';
    edit.style.cssText = `font:inherit;color:${isTableCell ? '#28a745' : '#21845e'};border:1px solid transparent;border-radius:4px;background:transparent;padding:2px 6px;margin:-2px -6px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;line-height:1.35;white-space:nowrap;transition:background .12s,border-color .12s,color .12s;`;
    edit.onmouseenter = () => {
        edit.style.background = 'rgba(40,167,69,.1)';
        edit.style.borderColor = 'rgba(40,167,69,.32)';
        edit.style.color = '#1e7e34';
    };
    edit.onmouseleave = () => {
        edit.style.background = 'transparent';
        edit.style.borderColor = 'transparent';
        edit.style.color = isTableCell ? '#28a745' : '#21845e';
    };

    const penSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    penSvg.setAttribute('viewBox', '0 0 16 16');
    penSvg.setAttribute('aria-hidden', 'true');
    penSvg.style.cssText = 'width:13px;height:13px;fill:none;stroke:#28a745;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;pointer-events:none;';
    penSvg.innerHTML = '<path d="M11 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5"/><path d="M13.5 1.5a1.414 1.414 0 0 1 2 2L9 10l-3 1 1-3 6.5-6.5z"/>';
    edit.appendChild(penSvg);

    if (options.prefixLabel) {
        const prefix = document.createElement('span');
        prefix.textContent = options.prefixLabel;
        prefix.style.cssText = 'color:#64748b;font-weight:400;font-size:11px;pointer-events:none;';
        edit.appendChild(prefix);
    }

    const valText = document.createElement('span');
    valText.style.cssText = `font-variant-numeric:tabular-nums;color:${isTableCell ? '#28a745' : '#21845e'};font-weight:500;pointer-events:none;`;
    edit.appendChild(valText);

    const form = document.createElement('span');
    form.hidden = true;
    form.style.cssText = 'display:none;align-items:center;gap:3px;background:#fff;border:1.5px solid #28a745;border-radius:5px;padding:1px 4px;box-shadow:0 2px 8px rgba(15,23,42,.14);height:28px;';

    const currency = document.createElement('span');
    currency.textContent = 'R$';
    currency.style.cssText = 'padding-left:3px;color:#64748b;font-size:11px;font-weight:600;user-select:none;';

    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'Preço de custo em reais');
    input.setAttribute('inputmode', 'decimal');
    input.placeholder = '0,00';
    input.autocomplete = 'off';
    input.style.cssText = 'font:600 12px system-ui,sans-serif;width:66px;min-width:0;padding:2px 4px;border:0;background:transparent;color:#0f172a;outline:none!important;box-shadow:none!important;font-variant-numeric:tabular-nums;text-align:right;height:22px;margin:0;';

    const save = document.createElement('button');
    save.type = 'button';
    save.title = 'Salvar (Enter)';
    save.setAttribute('aria-label', 'Salvar');
    save.textContent = '✓';
    save.style.cssText = 'border:0;border-radius:4px;width:22px;height:22px;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;line-height:1;color:#fff;background:#28a745;';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.title = 'Cancelar (Esc)';
    cancel.setAttribute('aria-label', 'Cancelar');
    cancel.textContent = '✕';
    cancel.style.cssText = 'border:0;border-radius:4px;width:22px;height:22px;padding:0;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1;color:#64748b;background:#f1f5f9;';

    form.append(currency, input, save, cancel);

    const status = document.createElement('small');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = `display:block;font:500 10.5px/1.3 system-ui,sans-serif;max-width:210px;white-space:normal;margin-top:2px;text-align:${isTableCell ? 'left' : 'right'};`;

    wrap.append(edit, form, status);
    host.appendChild(wrap);

    const setFormVisible = (visible: boolean) => {
        form.hidden = !visible;
        form.style.display = visible ? 'inline-flex' : 'none';
        edit.hidden = visible;
        edit.style.display = visible ? 'none' : 'inline-flex';
    };

    const syncDisplay = () => {
        const c = options.getCost();
        valText.textContent = formatInlineBrl(c, !isTableCell);
        edit.setAttribute('aria-label', c === null ? 'Informar preço de custo' : `Editar preço de custo (${formatInlineBrl(c, true)})`);
    };
    host.refreshDisplay = syncDisplay;
    syncDisplay();

    let expected: number | null = null, busy = false, clearTimer: number | undefined;

    // Impede que cliques, mousedown ou mouseup subam para a linha <tr> do Bling (evitando abrir o produto ao clicar no custo)
    for (const evtName of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'touchstart', 'touchend']) {
        host.addEventListener(evtName, event => {
            event.stopPropagation();
        });
    }

    const openEditorFn = () => {
        if (!options.isCurrent() || busy) return;
        window.clearTimeout(clearTimer);
        expected = options.getCost();
        input.value = expected === null ? '' : expected.toFixed(2).replace('.', ',');
        setFormVisible(true);
        status.textContent = '';
        save.disabled = false;
        input.focus();
        input.select();
    };
    host.openEditor = openEditorFn;

    edit.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        openEditorFn();
    };
    cancel.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        setFormVisible(false);
        status.textContent = '';
        syncDisplay();
        edit.focus();
    };
    save.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (busy) return;
        const value = parseCostInput(input.value);
        if (value === null) {
            status.style.color = '#b91c1c';
            status.textContent = 'Valor inválido (ex: 12,50)';
            return;
        }
        if (!host.isConnected || !options.isCurrent()) {
            status.textContent = 'Atualize a página.';
            return;
        }
        busy = true;
        save.disabled = true;
        cancel.disabled = true;
        input.disabled = true;
        status.style.color = '#64748b';
        status.textContent = 'Salvando…';
        form.setAttribute('aria-busy', 'true');
        let result: CostSaveResult;
        try {
            result = await options.save(value, expected);
            if (!result || typeof result.ok !== 'boolean') throw new Error('Resposta ausente');
        } catch {
            result = { ok: false, remoteUpdateMayHaveCompleted: false, error: 'Falha ao comunicar com o servidor.' };
        }
        busy = false;
        form.removeAttribute('aria-busy');
        cancel.disabled = false;
        input.disabled = false;
        if (!host.isConnected || !options.isCurrent()) return;
        if (result.ok && result.cost === value) {
            status.style.color = '#15803d';
            options.onSaved(value);
            syncDisplay();
            setFormVisible(false);
            status.textContent = options.successMessage || 'Salvo ✓';
            clearTimer = window.setTimeout(() => { status.textContent = ''; }, 2200);
        } else {
            status.style.color = '#b91c1c';
            status.textContent = result.error || 'Não foi possível salvar.';
            save.disabled = Boolean(result.remoteUpdateMayHaveCompleted);
        }
    };
    input.onkeydown = event => {
        event.stopPropagation();
        if (event.key === 'Enter') {
            event.preventDefault();
            save.click();
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            cancel.click();
        }
    };
    return host;
}
async function resolveBlingSupplierId(): Promise<string | undefined> {
    if (typeof location === 'undefined' || !/(?:^|\.)bling\.com\.br$/i.test(location.hostname)) return undefined;
    try {
        const cached = sessionStorage.getItem('paulifest_bling_supplier_id');
        if (cached && /^[1-9]\d{0,19}$/.test(cached)) return cached;
    } catch {}
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    try {
        const rc = await fetch('/Api/v3/contatos?limite=1', { credentials: 'include', headers });
        if (rc.ok) {
            const jc = await rc.json();
            const cid = String(jc?.data?.[0]?.id || '');
            if (/^[1-9]\d{0,19}$/.test(cid)) {
                try { sessionStorage.setItem('paulifest_bling_supplier_id', cid); } catch {}
                return cid;
            }
            const createRes = await fetch('/Api/v3/contatos', {
                method: 'POST',
                credentials: 'include',
                headers,
                body: JSON.stringify({ nome: 'Fornecedor Padrão', situacao: 'A', tipo: 'F' })
            });
            if (createRes.ok) {
                const created = await createRes.json();
                const newId = String(created?.data?.id || '');
                if (/^[1-9]\d{0,19}$/.test(newId)) {
                    try { sessionStorage.setItem('paulifest_bling_supplier_id', newId); } catch {}
                    return newId;
                }
            }
        }
    } catch {}
    return undefined;
}

export async function saveInlineCost(pageInstanceId: string, productId: string, value: number, expected: number | null): Promise<CostSaveResult> {
    const supplierId = await resolveBlingSupplierId();
    return chrome.runtime.sendMessage({
        type: 'BLING_UPDATE_COST',
        pageInstanceId,
        productId,
        value,
        expected,
        expectedUrl: location.href,
        confirmed: true,
        ...(supplierId ? { supplierId } : {})
    });
}
