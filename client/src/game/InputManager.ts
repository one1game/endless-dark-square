// Design: «Глухая тьма» — направления и огонь остаются двумя простыми семантическими состояниями ввода.
export type MoveVector = { x: number; y: number };

export class InputManager {
  private touchMove: MoveVector = { x: 0, y: 0 };
  private touchFiring = false;

  setTouchMove(x: number, y: number) {
    this.touchMove = {
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
    };
  }

  setTouchFiring(active: boolean) {
    this.touchFiring = active;
  }

  isFiring() {
    return this.touchFiring;
  }

  getMove(): MoveVector {
    const touchMagnitude = Math.hypot(this.touchMove.x, this.touchMove.y);
    if (touchMagnitude > 0.025) return this.touchMove;
    return { x: 0, y: 0 };
  }

  dispose() {}
}
