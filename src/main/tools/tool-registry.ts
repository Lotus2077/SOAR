import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { z } from "zod";

import { InspectGitChangesRequestV1Schema } from "../../shared/change-review-contracts";
import { inspectGitChanges } from "./inspect-git-changes";
import { listFiles, MAX_LIST_FILES_DEPTH, MAX_LIST_FILES_ITEMS } from "./list-files";
import { readTextFile } from "./read-text-file";
import { MAX_SEARCH_TEXT_DEPTH, MAX_SEARCH_TEXT_MATCHES, searchText } from "./search-text";

export interface ToolExecutionContext {
  workspaceRoot: string;
  signal?: AbortSignal;
}

export interface RegisteredTool {
  audience: "repository_agent_v1";
  definition: ChatCompletionTool;
  invoke(context: ToolExecutionContext, rawArguments: unknown): Promise<object>;
}

function defineTool<TSchema extends z.ZodType>(options: {
  definition: ChatCompletionTool;
  schema: TSchema;
  execute(context: ToolExecutionContext, arguments_: z.infer<TSchema>): Promise<object>;
}): RegisteredTool {
  return {
    audience: "repository_agent_v1",
    definition: options.definition,
    async invoke(context, rawArguments) {
      return options.execute(context, options.schema.parse(rawArguments));
    },
  };
}

const registry = {
  read_text_file: defineTool({
    definition: {
      type: "function",
      function: {
        name: "read_text_file",
        description:
          "Read one bounded UTF-8 text file inside the selected workspace. Use paths returned by list_files or search_text.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath"],
          properties: {
            relativePath: {
              type: "string",
              description: "POSIX-style path relative to the selected workspace root.",
            },
          },
        },
      },
    },
    schema: z.object({ relativePath: z.string().trim().min(1).max(4_096) }).strict(),
    execute: ({ workspaceRoot, signal }, { relativePath }) =>
      readTextFile({ workspaceRoot, relativePath, signal }),
  }),
  list_files: defineTool({
    definition: {
      type: "function",
      function: {
        name: "list_files",
        description:
          "List a bounded, deterministic repository subtree. Heavy dependency/build directories and credential files are omitted; symlinks are not followed.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            relativePath: {
              type: "string",
              description: "Directory or file path relative to the workspace; defaults to '.'.",
            },
            recursive: {
              type: "boolean",
              description: "Whether to descend into subdirectories; defaults to true.",
            },
            maxDepth: {
              type: "integer",
              minimum: 1,
              maximum: MAX_LIST_FILES_DEPTH,
              description: "Maximum recursive directory depth.",
            },
            maxItems: {
              type: "integer",
              minimum: 1,
              maximum: MAX_LIST_FILES_ITEMS,
              description: "Maximum number of entries to return.",
            },
          },
        },
      },
    },
    schema: z
      .object({
        relativePath: z.string().trim().min(1).max(4_096).optional(),
        recursive: z.boolean().optional(),
        maxDepth: z.number().int().min(1).max(MAX_LIST_FILES_DEPTH).optional(),
        maxItems: z.number().int().min(1).max(MAX_LIST_FILES_ITEMS).optional(),
      })
      .strict(),
    execute: ({ workspaceRoot, signal }, arguments_) =>
      listFiles({ workspaceRoot, signal, ...arguments_ }),
  }),
  search_text: defineTool({
    definition: {
      type: "function",
      function: {
        name: "search_text",
        description:
          "Search literal text in bounded UTF-8 repository files. Returns workspace-relative POSIX paths, 1-based line numbers, and matching lines.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: {
            query: {
              type: "string",
              minLength: 1,
              maxLength: 512,
              description: "Literal text to find (not a regular expression).",
            },
            relativePath: {
              type: "string",
              description: "File or directory path relative to the workspace; defaults to '.'.",
            },
            caseSensitive: {
              type: "boolean",
              description: "Use case-sensitive matching; defaults to true.",
            },
            maxDepth: {
              type: "integer",
              minimum: 1,
              maximum: MAX_SEARCH_TEXT_DEPTH,
              description: "Maximum recursive directory depth.",
            },
            maxMatches: {
              type: "integer",
              minimum: 1,
              maximum: MAX_SEARCH_TEXT_MATCHES,
              description: "Maximum matching lines to return.",
            },
          },
        },
      },
    },
    schema: z
      .object({
        query: z.string().min(1).max(512),
        relativePath: z.string().trim().min(1).max(4_096).optional(),
        caseSensitive: z.boolean().optional(),
        maxDepth: z.number().int().min(1).max(MAX_SEARCH_TEXT_DEPTH).optional(),
        maxMatches: z.number().int().min(1).max(MAX_SEARCH_TEXT_MATCHES).optional(),
      })
      .strict(),
    execute: ({ workspaceRoot, signal }, arguments_) =>
      searchText({ workspaceRoot, signal, ...arguments_ }),
  }),
} satisfies Record<string, RegisteredTool>;

export interface RegisteredHostTool {
  audience: "host_change_acquisition_v1";
  invoke(context: ToolExecutionContext, rawArguments: unknown): Promise<object>;
}

const hostRegistry = {
  inspect_git_changes: {
    audience: "host_change_acquisition_v1",
    async invoke(context: ToolExecutionContext, rawArguments: unknown) {
      const request = InspectGitChangesRequestV1Schema.parse(rawArguments);
      return inspectGitChanges({
        workspaceRoot: context.workspaceRoot,
        request,
        signal: context.signal,
      });
    },
  },
} satisfies Record<string, RegisteredHostTool>;

export type RegisteredToolName = keyof typeof registry;
export type HostToolName = keyof typeof hostRegistry;

export const TOOL_REGISTRY: Readonly<typeof registry> = Object.freeze(registry);
export const HOST_TOOL_REGISTRY: Readonly<typeof hostRegistry> = Object.freeze(hostRegistry);

export const MODEL_TOOL_DEFINITIONS: readonly ChatCompletionTool[] = Object.freeze(
  Object.values(registry).map((tool) => tool.definition),
);

function isRegisteredToolName(name: string): name is RegisteredToolName {
  return Object.prototype.hasOwnProperty.call(registry, name);
}

export function getRegisteredTool(name: string): RegisteredTool | undefined {
  return isRegisteredToolName(name) ? registry[name] : undefined;
}

function isHostToolName(name: string): name is HostToolName {
  return Object.prototype.hasOwnProperty.call(hostRegistry, name);
}

export function getHostTool(name: string): RegisteredHostTool | undefined {
  return isHostToolName(name) ? hostRegistry[name] : undefined;
}
