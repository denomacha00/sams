let apiReady = false;

export function isApiReady(): boolean {
  return apiReady;
}

export function setApiReady(ready: boolean): void {
  apiReady = ready;
}
