// Agent OS provider cost gate.
//
// This is the financial airlock immediately before a provider process/API
// call. Blocks owns the execution seam; Agent OS owns the reservation.
//
// IMPORTANT: the default gate is fail-closed. A paid provider cannot spawn
// unless the Agent OS host installs a gate and supplies a valid reservation.

export interface CostGateReservation {
  reservationId: string;
  projectId?: string;
  taskId?: string;
}

export interface ProviderCostGate {
  authorize(input: {
    reservationId: string;
    provider: string;
    model: string;
    projectId?: string;
    taskId?: string;
  }): Promise<CostGateReservation> | CostGateReservation;
  settle(input: {
    reservationId: string;
    provider: string;
    model: string;
    actualCostUsd: number;
    result: "ok" | "error" | "denied";
  }): Promise<void> | void;
  release(input: { reservationId: string; provider: string; model: string }): Promise<void> | void;
}

class FailClosedCostGate implements ProviderCostGate {
  authorize(input: { reservationId: string; provider: string; model: string }): never {
    throw new Error(
      `Agent OS cost gate is not installed; refusing ${input.provider}/${input.model} execution (reservation ${input.reservationId}).`,
    );
  }
  settle(): void {}
  release(): void {}
}

let installedGate: ProviderCostGate = new FailClosedCostGate();

export function installProviderCostGate(gate: ProviderCostGate): void {
  installedGate = gate;
}

export function resetProviderCostGate(): void {
  installedGate = new FailClosedCostGate();
}

export function getProviderCostGate(): ProviderCostGate {
  return installedGate;
}
