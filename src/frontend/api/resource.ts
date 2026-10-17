export type ResourceState<T> = { data?: T; error: Error | null; isLoading: boolean };

/** Only the most recent request can publish. Aborting also invalidates late responses. */
export class Resource<T> {
  private controller?: AbortController;
  private generation = 0;
  private inFlight = false;
  state: ResourceState<T> = { error: null, isLoading: true };
  constructor(
    private load: (signal: AbortSignal) => Promise<T>,
    private publish: (state: ResourceState<T>) => void,
  ) {}
  async refresh() {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    this.inFlight = true;
    this.state = { ...this.state, error: null, isLoading: true };
    this.publish(this.state);
    try {
      const data = await this.load(controller.signal);
      if (generation !== this.generation) return;
      this.state = { data, error: null, isLoading: false };
      this.publish(this.state);
    } catch (cause) {
      if (generation !== this.generation) return;
      const error = cause instanceof Error ? cause : Error(String(cause));
      this.state = { ...this.state, error, isLoading: false };
      this.publish(this.state);
      throw error;
    } finally {
      if (generation === this.generation) this.inFlight = false;
    }
  }
  async poll() {
    if (this.inFlight) return;
    await this.refresh();
  }
  dispose() {
    this.generation++;
    this.inFlight = false;
    this.controller?.abort();
  }
}
