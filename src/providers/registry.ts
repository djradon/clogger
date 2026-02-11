import type { Provider } from "./base.js";
import { ClaudeCodeProvider } from "./claude-code/index.js";

/** Registry of available LLM providers */
export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  constructor() {
    // Register built-in providers
    this.register(new ClaudeCodeProvider());
  }

  register(provider: Provider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): Provider | undefined {
    return this.providers.get(name);
  }

  getAll(): Provider[] {
    return [...this.providers.values()];
  }

  getEnabled(enabledNames: string[]): Provider[] {
    return enabledNames
      .map((name) => this.providers.get(name))
      .filter((p): p is Provider => p !== undefined);
  }
}
