import { useMemo } from "react";
import { useRpc, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import type { docsRpcContract } from "./server.js";

export function useDocsRpc() {
  const rpc = useRpc<typeof docsRpcContract>();
  const { mutate: saveNote } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "saveNote"
  >({ method: "saveNote" });
  const { mutate: updateProposal } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "updateProposal"
  >({ method: "updateProposal" });
  const { mutate: resolveProposal } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "resolveProposal"
  >({ method: "resolveProposal" });
  const { mutate: createNote } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "createNote"
  >({ method: "createNote" });
  const { mutate: deletePath } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "deletePath"
  >({ method: "deletePath" });
  const { mutate: createFolder } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "createFolder"
  >({ method: "createFolder" });
  const { mutate: reorderFiles } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "reorderFiles"
  >({ method: "reorderFiles" });
  const { mutate: movePath } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "movePath"
  >({ method: "movePath" });
  const { mutate: renameToTitle } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "renameToTitle"
  >({ method: "renameToTitle" });
  const { mutate: createVault } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "createVault"
  >({ method: "createVault" });
  const { mutate: uploadAttachment } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "uploadAttachment"
  >({ method: "uploadAttachment" });
  const { mutate: saveOpenedFile } = experimental_useRpcMutation<
    typeof docsRpcContract,
    "saveOpenedFile"
  >({ method: "saveOpenedFile" });
  return useMemo(
    () => ({
      ...rpc,
      saveNote,
      updateProposal,
      resolveProposal,
      createNote,
      deletePath,
      createFolder,
      reorderFiles,
      movePath,
      renameToTitle,
      createVault,
      uploadAttachment,
      saveOpenedFile,
    }),
    [
      rpc,
      saveNote,
      updateProposal,
      resolveProposal,
      createNote,
      deletePath,
      createFolder,
      reorderFiles,
      movePath,
      renameToTitle,
      createVault,
      uploadAttachment,
      saveOpenedFile,
    ],
  );
}
