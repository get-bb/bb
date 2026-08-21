interface OptionRequestLease {
  complete(): void;
  fail(): void;
  cancel(): void;
}

interface ActiveRequest {
  key: string;
  token: symbol;
  complete: boolean;
}

export class OptionRequestGate {
  private active: ActiveRequest | null = null;

  reset(): void {
    this.active = null;
  }

  begin(key: string): OptionRequestLease | null {
    if (this.active?.key === key) return null;

    const token = Symbol(key);
    this.active = { key, token, complete: false };
    const releasePending = () => {
      if (this.active?.token === token && !this.active.complete) {
        this.active = null;
      }
    };

    return {
      complete: () => {
        if (this.active?.token === token) this.active.complete = true;
      },
      fail: releasePending,
      cancel: releasePending,
    };
  }
}
