import { mergeAttributes, Node, type AnyExtension } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { CalloutView } from "../blocks/Callout";

export type CalloutVariant = "info" | "warning" | "success" | "danger";

/**
 * Callout block — a typed node inside the stored Tiptap JSON (§14). It is a
 * code-level registry entry, not a database entity.
 */
export const CalloutExtension: AnyExtension = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      variant: {
        default: "info",
        parseHTML: (element) => element.getAttribute("data-variant") ?? "info",
        renderHTML: (attributes) => ({ "data-variant": attributes.variant }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": node.attrs.variant })];
  },

  addCommands() {
    return {
      setCallout:
        (variant: CalloutVariant = "info") =>
        ({ commands }) => {
          return commands.insertContent({
            type: "callout",
            attrs: { variant },
            content: [{ type: "paragraph" }],
          });
        },
    };
  },

  addNodeView() {
    // ReactNodeViewRenderer's return type predates the node-view dispatcher
    // signature in newer @tiptap/core; widened via a typed-any local because
    // the two library versions disagree on the node-view contract.
    const view = ReactNodeViewRenderer(CalloutView) as unknown;
    return view as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (variant?: CalloutVariant) => ReturnType;
    };
  }
}
