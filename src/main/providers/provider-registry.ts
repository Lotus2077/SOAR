import {
  assertProviderAccountingFresh,
  hasProviderCapabilities,
  parseProviderDescriptor,
  type ProviderAccountingFreshnessInput,
  type ProviderCapability,
  type ProviderDescriptor,
} from "./provider-descriptor";
import type { DescribedInferenceProvider } from "./types";

export interface ProviderRegistration {
  descriptor: ProviderDescriptor;
  provider: DescribedInferenceProvider;
}

export class ProviderRegistry {
  private readonly registrations: ReadonlyMap<string, ProviderRegistration>;

  constructor(entries: readonly ProviderRegistration[]) {
    if (entries.length === 0) {
      throw new RangeError("provider registry needs at least one provider");
    }

    const registrations = new Map<string, ProviderRegistration>();
    for (const entry of entries) {
      const descriptor = parseProviderDescriptor(entry.descriptor);
      if (registrations.has(descriptor.id)) {
        throw new Error(`duplicate provider id: ${descriptor.id}`);
      }
      if (
        entry.provider.id !== descriptor.id ||
        entry.provider.model !== descriptor.model ||
        entry.provider.descriptor.id !== descriptor.id ||
        entry.provider.descriptor.model !== descriptor.model
      ) {
        throw new Error(
          `provider implementation identity does not match descriptor ${descriptor.id}`,
        );
      }
      const expectedCostPolicy =
        descriptor.accounting.kind === "local_zero_cost"
          ? "local_zero_cost"
          : undefined;
      if (entry.provider.costPolicy !== expectedCostPolicy) {
        throw new Error(
          `provider implementation cost policy does not match descriptor ${descriptor.id}`,
        );
      }
      if (entry.provider.descriptor !== entry.descriptor) {
        const providerDescriptor = parseProviderDescriptor(
          entry.provider.descriptor,
        );
        if (JSON.stringify(providerDescriptor) !== JSON.stringify(descriptor)) {
          throw new Error(
            `provider implementation descriptor does not match registration ${descriptor.id}`,
          );
        }
      }
      registrations.set(
        descriptor.id,
        Object.freeze({ descriptor, provider: entry.provider }),
      );
    }
    this.registrations = registrations;
  }

  listDescriptors(options: { includeDisabled?: boolean } = {}): ProviderDescriptor[] {
    return [...this.registrations.values()]
      .map((entry) => entry.descriptor)
      .filter((descriptor) => options.includeDisabled || descriptor.enabled)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /** Metadata lookup for diagnostics/UI. Provider instances require admission. */
  getDescriptor(id: string): ProviderDescriptor | undefined {
    return this.registrations.get(id)?.descriptor;
  }

  require(
    id: string,
    requiredCapabilities: readonly ProviderCapability[] = [],
    accountingFreshness?: ProviderAccountingFreshnessInput,
  ): ProviderRegistration {
    const registration = this.registrations.get(id);
    if (!registration) throw new Error(`unknown provider id: ${id}`);
    if (!registration.descriptor.enabled) {
      throw new Error(`provider is disabled: ${id}`);
    }
    if (
      !hasProviderCapabilities(
        registration.descriptor,
        requiredCapabilities,
      )
    ) {
      throw new Error(
        `provider ${id} lacks required capabilities: ${requiredCapabilities.join(", ")}`,
      );
    }
    if (registration.descriptor.accounting.kind === "metered") {
      if (!accountingFreshness) {
        throw new Error(
          `paid provider ${id} requires an explicit pricing as-of time`,
        );
      }
      assertProviderAccountingFresh(
        registration.descriptor,
        accountingFreshness,
      );
    }
    return registration;
  }
}
