# Padrão SKU Paulifest

O SKU usa o nome do Bling como entrada, sem depender do título comercial do Mercado Livre.

Pai: MARCA + PRODUTO + ATRIBUTO FIXO opcional + MEDIDA BASE opcional, sem separadores (5–16 caracteres).
Filho: PAI + hífen + VARIAÇÃO (7–20 caracteres). Não há truncamento silencioso: blocos inválidos pedem ajuste.

- Marca: 2–3 letras. POPPER → POP, BOMPACK → BP, GOUR MAX → GM, PIC PIC → PP, FREEGELLS → FRE.
- Produto: 3–6 letras. Tinta/spray pinta cabelo → TPC; luva nitrílica → LUVNIT; pote retangular → POTRET.
- Atributo fixo: 2–4 caracteres, opcional. Luva preta → PR; fluorescente → FLUO.
- Medida base: opcional (até 5 caracteres). 150ml → 150; 100un → 100; 24un → 24. Quando é 1 unidade (`1un`) ou sem medida base informada, não força `1UN` (fica vazio).
- Variação: sempre que houver **sabor** (MOR, UVA, MEN, LIM, CER, CHO, BAU, TUT, etc.) ou **cor** (AZ, VM, AM, PR, BR, RS, VD, RX, DOU, PRT, etc.), tamanho (P/M/G/GG), capacidade (250/500/750/1000) ou polegadas (5POL/9POL/12POL/18POL), entra como variação (`-VAR`) e nunca como bloco do produto.
- Apenas A–Z e 0–9 nos blocos. Acentos, espaços e pontuação são removidos. Apenas um hífen, entre pai e variação.

Exemplos: POPTPC150-AZ, BPLUVNITPR100-GG, GMPOTRET24-500, FREBALA-MOR, POPVELA-AZ, PPBALAO-DOU.
