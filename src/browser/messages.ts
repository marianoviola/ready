import type {
  Annotation,
  Article,
  BookmarkNode,
  ReadingPosition,
  ReadingSession,
  ReadingStatus,
  TextAnchor
} from "../domain/types";

export type ReadyRequest =
  | { type: "GET_BOOKMARK_TREE" }
  | { type: "LINK_BOOKMARKS"; bookmarkIds: string[] }
  | { type: "SAVE_ACTIVE_PAGE"; folderId?: string }
  | { type: "RESTORE_BOOKMARK"; articleId: string; folderId?: string }
  | {
      type: "REMOVE_ARTICLE";
      articleId: string;
      deleteBookmark: boolean;
    }
  | { type: "OPEN_ARTICLE"; articleId: string; resume: boolean }
  | { type: "GET_PAGE_DATA"; url: string }
  | {
      type: "SAVE_READING_UPDATE";
      articleId: string;
      progress: number;
      position?: ReadingPosition;
      activeSeconds: number;
      session?: ReadingSession;
    }
  | {
      type: "CREATE_ANNOTATION";
      articleId: string;
      anchor: TextAnchor;
      note?: string;
    }
  | {
      type: "UPDATE_ANNOTATION";
      annotationId: string;
      note?: string;
      unresolved?: boolean;
    }
  | { type: "DELETE_ANNOTATION"; annotationId: string }
  | { type: "SET_STATUS"; articleId: string; status: ReadingStatus };

export type ReadyResponse =
  | { ok: true; bookmarkTree: BookmarkNode[] }
  | { ok: true; linked: number }
  | { ok: true; article: Article; createdBookmark: boolean }
  | { ok: true; removedBookmark: boolean }
  | {
      ok: true;
      article?: Article;
      annotations: Annotation[];
      shouldResume: boolean;
    }
  | { ok: true; annotation: Annotation }
  | { ok: true }
  | { ok: false; error: string };

export async function sendReadyMessage(
  request: ReadyRequest
): Promise<ReadyResponse> {
  const response = (await chrome.runtime.sendMessage(request)) as ReadyResponse;
  if (!response) {
    throw new Error("Ready did not receive a response from the extension.");
  }
  return response;
}
