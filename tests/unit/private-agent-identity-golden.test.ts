import { describe, expect, it } from "vitest";
import { goldenValues, layout2BodiesWithTrailingOption } from "./private-agent-identity-golden.fixture";

/** Computed by the fixture at 7fd67e1, before any Anthropic adapter code (BL-20261030-0620). */
const BEFORE_ADAPTER = {
  modelIdentity: {
    localHeavy: "74a9a3ceed42da1caf5e7a229b110d2994b1ba7661a32390e0361c40942174ab",
    responses: "f583a28177cb08a390c1ab73b97d580bbd97e397e9badf76ea2e83936071b387",
    chat: "f935646049df796710f7c6b2a87cf7dca866e86e4be9ef76aa3f08da6046ae25",
  },
  destinations: {
    owned_local_model: { destinationSha256: "5a112508c6da4ef42ea2710122862389638fac68c143a5457e72d367575c6f61", packetSha256: "5568b0e1710920271ca4ea7a1db2cfe5edcd14ab872c2258a05a1378acb28f13" },
    cloud_coordinator: { destinationSha256: "a0dbbbaa2ddc27d71ebf101136e763beb868adb5d6d0394c82a0a8efeccd344f", packetSha256: "80f7c3b8f98ee2df6ef874da6e5ead3e7c671d00c6d86617d3c9fa516687304c" },
    approved_public_snapshots: { destinationSha256: "49ed63e30c4e89942f75a005c1b5ffd315a0421b82befd328ab5b6bdc5635266", packetSha256: "215112effc34679db0b066405626c16a63bec7e4d137c414cba19204362d3ef9" },
  },
  bodies: {
    vllm: "bf3d89cabcb670db4c62cbd1929468744fc55af05f7506d83a267f80537ad66b",
    chat: "a82b6d978926033f961c75c01556da3e93d541cbc7bcf80ff62eea655a518f86",
    responses: "d1f536bb6c761c273ae7364aad5f4baa6192380d39f9eddadeec89166e0181b9",
    responsesOneShot: "3aabef8e2e0c6e96f317a5c7b6e95b99fb7ea364a4b8bb7efed62ad03d06a16c",
  },
  freeze: {
    responses: "84d9cf0570ad5cab9ea60fe4f6162e299d7ebaa66305674e7d725ffd50ad6d33",
    chat: "73dfe8d50228153cd2bbf846a985da8662ad3ea9a1ee00b6af2ed462e5e7a967",
  },
  promptProtocol: {
    sha256: "a1d21394d6e897504f4ac8d15c9f2d6d47e09bca259ee4dc387f0e1187b7b0d1",
    identity: "07d7ce76258b861fc3317cd962f26a5b8f27a43e6181f99411e19594500b1a74",
  },
};

describe("identities that existed before the Anthropic adapter", () => {
  it("keeps every model identity, destination fingerprint, packet, request body, cloud freeze and prompt protocol byte-identical", async () => {
    expect(await goldenValues()).toEqual(BEFORE_ADAPTER);
  });

  it("sends the same body on every existing shape when the runner passes the layout-2 trailing-message option", async () => {
    const { vllm, chat, responses } = BEFORE_ADAPTER.bodies;
    expect(await layout2BodiesWithTrailingOption()).toEqual({ vllm, chat, responses });
  });
});
