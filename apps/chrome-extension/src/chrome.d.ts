// Narrow declarations for the Chrome APIs used here. No webpage/native execution surface.
declare const chrome: {
  runtime: {
    id: string;
    lastError?: { message?: string };
    getURL(path: string): string;
    getContexts(filter: {
      documentUrls: string[];
    }): Promise<Array<{ tabId: number; windowId: number }>>;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: {
            id?: string;
            url?: string;
            frameId?: number;
            tab?: { id?: number; active?: boolean };
          },
          respond: (response: unknown) => void
        ) => boolean | void
      ): void;
    };
    onStartup: { addListener(callback: () => void): void };
  };
  action: {
    onClicked: { addListener(callback: () => void): void };
    setBadgeText(details: { text: string }): Promise<void>;
    setBadgeBackgroundColor(details: { color: string }): Promise<void>;
    setTitle(details: { title: string }): Promise<void>;
  };
  tabs: {
    create(details: { url: string; active?: boolean }): Promise<{ id?: number }>;
    get(id: number): Promise<{ id?: number; active: boolean; windowId: number; url?: string }>;
    query(query: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Array<{ id?: number; active?: boolean }>>;
    sendMessage(id: number, message: unknown): Promise<unknown>;
    update(id: number, details: { active: boolean }): Promise<unknown>;
    onRemoved: { addListener(callback: (id: number) => void): void };
    onActivated: { addListener(callback: (info: { tabId: number }) => void): void };
  };
  windows: { update(id: number, details: { focused: boolean }): Promise<unknown> };
  commands: { onCommand: { addListener(callback: (command: string) => void): void } };
  storage: {
    onChanged: {
      addListener(
        callback: (changes: Record<string, { newValue?: unknown }>, area: string) => void
      ): void;
    };
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(value: Record<string, unknown>): Promise<void>;
    };
    session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(value: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  };
  permissions: {
    request(value: { origins: string[] }): Promise<boolean>;
    contains(value: { origins: string[] }): Promise<boolean>;
    remove(value: { origins: string[] }): Promise<boolean>;
  };
  scripting: {
    executeScript(details: { target: { tabId: number }; files: string[] }): Promise<unknown>;
    registerContentScripts(
      scripts: Array<{
        id: string;
        matches: string[];
        js: string[];
        runAt: 'document_idle';
        persistAcrossSessions: boolean;
      }>
    ): Promise<void>;
    getRegisteredContentScripts(): Promise<Array<{ id: string }>>;
    unregisterContentScripts(value: { ids: string[] }): Promise<void>;
  };
  desktopCapture: {
    chooseDesktopMedia(
      sources: string[],
      targetTab: { id?: number; url?: string },
      callback: (id: string, options: { canRequestAudioTrack: boolean }) => void
    ): number;
    cancelChooseDesktopMedia(id: number): void;
  };
};
