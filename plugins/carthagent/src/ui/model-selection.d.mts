export interface SelectableModel {
  providerID: string;
  id: string;
  modelID: string;
  name: string;
  variants: readonly { id: string }[];
}

export type ModelSelection = { providerID: string; id: string; variant?: string };

export function selectModelWithVariant(input: {
  model: SelectableModel;
  variant?: string;
  promptForVariant?: boolean;
  chooseVariant?: (model: SelectableModel) => Promise<string | undefined>;
  switchModel: (selection: ModelSelection) => Promise<unknown>;
}): Promise<
  | { status: "cancelled" }
  | { status: "invalid"; variant: string }
  | { status: "selected"; variant?: string }
>;
