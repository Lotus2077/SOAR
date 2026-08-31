import {
  CloudCandidateMetadataSchema,
  cloudCandidateMetadata,
  type CloudCandidateMetadata,
} from "../../shared/cloud-setup-contracts";

/**
 * PR6A metadata only. This object is intentionally not a ProviderDescriptor and
 * cannot be dispatched by ProviderRegistry or SessionRunner.
 */
export const LOCKED_CLOUD_PROVIDER_CANDIDATES: readonly CloudCandidateMetadata[] =
  Object.freeze([
    Object.freeze(CloudCandidateMetadataSchema.parse(cloudCandidateMetadata())),
  ]);
