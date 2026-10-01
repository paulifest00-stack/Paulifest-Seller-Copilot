import React from 'react';
import type { AuditedField, CentralProductSheet } from '../../../core/schema/product.ts';
import { MlPricingCalculator } from '../MlPricingCalculator.tsx';

/**
 * Validador guard de custo (Schema v3).
 * Garante que custos com status 'missing' ou inválidos não sejam computados como 0.
 */
export function isCostPriceComputable(field?: AuditedField<number | null> | null): boolean {
  return (
    !!field &&
    field.status !== 'missing' &&
    typeof field.value === 'number' &&
    Number.isFinite(field.value) &&
    field.value >= 0
  );
}

interface Props {
  sheet: CentralProductSheet;
  onUpdateSheet: (fn: (s: CentralProductSheet) => CentralProductSheet) => void;
  onPrev: () => void;
  onFinish?: () => void;
}

export const StepPricing: React.FC<Props> = ({
  sheet,
  onUpdateSheet,
  onPrev,
  onFinish
}) => {
  return (
    <MlPricingCalculator
      sheet={sheet}
      onUpdateSheet={onUpdateSheet}
      onPrev={onPrev}
      onFinish={onFinish}
    />
  );
};

export default StepPricing;
