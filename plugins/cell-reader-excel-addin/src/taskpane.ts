import "./taskpane.css";

type CellTarget = {
  sheetId: string;
  address: string;
};

type WholeCellFont = {
  bold: boolean;
  color: string;
  italic: boolean;
  underline: Excel.RangeUnderlineStyle | string;
};

type InlineFormatAction =
  | { type: "toggle"; property: "bold" | "italic" | "underline" }
  | { type: "color"; color: string }
  | { type: "clear" };

type CellSnapshot = {
  target: CellTarget;
  sheetName: string;
  address: string;
  displayText: string;
  rawText: string;
  formulaText: string;
  valueType: string;
  canEdit: boolean;
  editReason: string;
  textRuns: Excel.RangeTextRun[];
  wholeCellFont: WholeCellFont;
};

const elements = {
  loading: requiredElement<HTMLElement>("loadingState"),
  unsupported: requiredElement<HTMLElement>("unsupportedState"),
  error: requiredElement<HTMLElement>("errorState"),
  reader: requiredElement<HTMLElement>("reader"),
  errorMessage: requiredElement<HTMLElement>("errorMessage"),
  sheetName: requiredElement<HTMLElement>("sheetName"),
  cellAddress: requiredElement<HTMLElement>("cellAddress"),
  cellContent: requiredElement<HTMLElement>("cellContent"),
  editorToolbar: requiredElement<HTMLElement>("editorToolbar"),
  boldButton: requiredElement<HTMLButtonElement>("boldButton"),
  italicButton: requiredElement<HTMLButtonElement>("italicButton"),
  underlineButton: requiredElement<HTMLButtonElement>("underlineButton"),
  colorSwatches: requiredElements<HTMLButtonElement>(".color-swatch"),
  clearFormatButton: requiredElement<HTMLButtonElement>("clearFormatButton"),
  editModeBadge: requiredElement<HTMLElement>("editModeBadge"),
  saveButton: requiredElement<HTMLButtonElement>("saveButton"),
  rawValue: requiredElement<HTMLElement>("rawValue"),
  formulaValue: requiredElement<HTMLElement>("formulaValue"),
  valueType: requiredElement<HTMLElement>("valueType"),
  characterCount: requiredElement<HTMLElement>("characterCount"),
  statusLine: requiredElement<HTMLElement>("statusLine"),
  copyButton: requiredElement<HTMLButtonElement>("copyButton"),
  copyLabel: requiredElement<HTMLElement>("copyLabel"),
  refreshButton: requiredElement<HTMLButtonElement>("refreshButton"),
  retryButton: requiredElement<HTMLButtonElement>("retryButton"),
};

const supportsRichText = () => Office.context.requirements.isSetSupported("ExcelApi", "1.18");

let currentDisplayText = "";
let activeTarget: CellTarget | null = null;
let currentCanEdit = false;
let currentWholeCellFont: WholeCellFont = defaultWholeCellFont();
let editorDirty = false;
let isWritingToExcel = false;
let refreshGeneration = 0;
let refreshTimer: number | undefined;
let saveTimer: number | undefined;
let copyResetTimer: number | undefined;
let savedEditorSelection: Range | null = null;
let saveInFlight: Promise<void> | null = null;

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) {
    showOnly(elements.unsupported);
    return;
  }

  bindUiEvents();
  await initialize();
});

function bindUiEvents(): void {
  elements.refreshButton.addEventListener("click", () => {
    void (async () => {
      await flushPendingSave();
      await refreshActiveCell();
    })();
  });
  elements.retryButton.addEventListener("click", () => void initialize());
  elements.copyButton.addEventListener("click", () => void copyCurrentContent());
  elements.saveButton.addEventListener("click", () => void saveEditorChanges());
  elements.cellContent.addEventListener("input", handleEditorInput);
  elements.cellContent.addEventListener("keydown", handleEditorKeyDown);
  elements.cellContent.addEventListener("paste", handleEditorPaste);
  elements.cellContent.addEventListener("blur", saveEditorSelection);
  elements.cellContent.addEventListener("mouseup", saveEditorSelection);
  elements.cellContent.addEventListener("keyup", saveEditorSelection);
  document.addEventListener("selectionchange", handleDocumentSelectionChange);

  bindFormatButton(elements.boldButton, "bold");
  bindFormatButton(elements.italicButton, "italic");
  bindFormatButton(elements.underlineButton, "underline");

  elements.clearFormatButton.addEventListener("mousedown", preserveEditorSelection);
  elements.clearFormatButton.addEventListener("click", () => {
    if (supportsRichText()) {
      applySelectionFormat({ type: "clear" });
    } else {
      void applyWholeCellFont({ bold: false, color: "#000000", italic: false, underline: Excel.RangeUnderlineStyle.none });
    }
  });

  elements.colorSwatches.forEach((swatch) => {
    swatch.addEventListener("mousedown", preserveEditorSelection);
    swatch.addEventListener("click", () => {
      const color = swatch.dataset.color;
      if (!color) return;
      if (supportsRichText()) {
        applySelectionFormat({ type: "color", color });
      } else {
        void applyWholeCellFont({ color });
      }
    });
  });
}

function bindFormatButton(button: HTMLButtonElement, command: "bold" | "italic" | "underline"): void {
  button.addEventListener("mousedown", preserveEditorSelection);
  button.addEventListener("click", () => {
    if (supportsRichText()) {
      applySelectionFormat({ type: "toggle", property: command });
      return;
    }

    if (command === "bold") {
      void applyWholeCellFont({ bold: !currentWholeCellFont.bold });
    } else if (command === "italic") {
      void applyWholeCellFont({ italic: !currentWholeCellFont.italic });
    } else {
      const isUnderlined = String(currentWholeCellFont.underline).toLowerCase() !== "none";
      void applyWholeCellFont({
        underline: isUnderlined ? Excel.RangeUnderlineStyle.none : Excel.RangeUnderlineStyle.single,
      });
    }
  });
}

async function initialize(): Promise<void> {
  showOnly(elements.loading);

  try {
    await Excel.run(async (context) => {
      context.workbook.onSelectionChanged.add(handleSelectionChanged);

      if (Office.context.requirements.isSetSupported("ExcelApi", "1.9")) {
        context.workbook.worksheets.onChanged.add(handleWorksheetChanged);
      }

      await context.sync();
    });

    await refreshActiveCell();
  } catch (error) {
    showError(error);
  }
}

async function handleSelectionChanged(): Promise<void> {
  await flushPendingSave();
  scheduleRefresh(40);
}

async function handleWorksheetChanged(): Promise<void> {
  if (isWritingToExcel) {
    return;
  }

  if (editorDirty) {
    elements.statusLine.textContent = "Excel 中的内容已变化；保存当前编辑后将重新同步";
    elements.statusLine.classList.add("is-warning");
    return;
  }

  scheduleRefresh(100);
}

function scheduleRefresh(delay: number): void {
  if (refreshTimer !== undefined) {
    window.clearTimeout(refreshTimer);
  }

  refreshTimer = window.setTimeout(() => {
    refreshTimer = undefined;
    void refreshActiveCell();
  }, delay);
}

async function refreshActiveCell(): Promise<void> {
  const generation = ++refreshGeneration;
  setBusy(true);

  try {
    const snapshot = await Excel.run(async (context): Promise<CellSnapshot> => {
      const cell = context.workbook.getActiveCell();
      const sheet = context.workbook.worksheets.getActiveWorksheet();
      const richTextResult = supportsRichText() ? cell.getCellProperties({ textRuns: true }) : null;

      cell.load(["address", "text", "values", "formulas"]);
      cell.format.font.load(["bold", "color", "italic", "underline"]);
      sheet.load(["id", "name"]);
      await context.sync();

      const displayValue = cell.text[0]?.[0] ?? "";
      const rawValue = cell.values[0]?.[0] ?? "";
      const formulaValue = cell.formulas[0]?.[0] ?? "";
      const formulaText = isFormula(formulaValue) ? String(formulaValue) : "";
      const editability = getEditability(rawValue, formulaText);
      const properties = richTextResult?.value[0]?.[0];

      return {
        target: { sheetId: sheet.id, address: shortAddress(cell.address) },
        sheetName: sheet.name,
        address: shortAddress(cell.address),
        displayText: stringifyCellValue(displayValue),
        rawText: stringifyCellValue(rawValue),
        formulaText,
        valueType: describeValueType(rawValue),
        canEdit: editability.canEdit,
        editReason: editability.reason,
        textRuns: properties?.textRuns ?? [],
        wholeCellFont: {
          bold: cell.format.font.bold ?? false,
          color: cell.format.font.color || "#000000",
          italic: cell.format.font.italic ?? false,
          underline: cell.format.font.underline ?? Excel.RangeUnderlineStyle.none,
        },
      };
    });

    if (generation !== refreshGeneration) {
      return;
    }

    renderSnapshot(snapshot);
  } catch (error) {
    if (generation === refreshGeneration) {
      showError(error);
    }
  } finally {
    if (generation === refreshGeneration) {
      setBusy(false);
    }
  }
}

function renderSnapshot(snapshot: CellSnapshot): void {
  activeTarget = snapshot.target;
  currentCanEdit = snapshot.canEdit;
  currentWholeCellFont = snapshot.wholeCellFont;
  currentDisplayText = snapshot.displayText;
  editorDirty = false;
  savedEditorSelection = null;

  elements.sheetName.textContent = snapshot.sheetName;
  elements.cellAddress.textContent = snapshot.address;
  renderEditorContent(snapshot);
  elements.rawValue.textContent = snapshot.rawText || "（空）";
  elements.formulaValue.textContent = snapshot.formulaText || "无";
  elements.valueType.textContent = snapshot.valueType;
  updateCharacterCount(snapshot.displayText);
  elements.statusLine.textContent = "Excel 与面板内容已同步";
  elements.statusLine.classList.remove("is-warning");
  elements.copyButton.disabled = snapshot.displayText.length === 0;
  elements.saveButton.textContent = "已保存";
  elements.saveButton.disabled = true;
  configureEditingMode(snapshot);
  updateToolbarState();
  showOnly(elements.reader);
}

function renderEditorContent(snapshot: CellSnapshot): void {
  elements.cellContent.replaceChildren();
  elements.cellContent.classList.toggle("is-empty", snapshot.displayText.length === 0);

  if (snapshot.displayText.length === 0) {
    return;
  }

  if (!supportsRichText() || snapshot.textRuns.length === 0) {
    elements.cellContent.textContent = snapshot.displayText;
    return;
  }

  const richText = snapshot.textRuns.map((run) => run.text).join("");
  if (richText !== snapshot.displayText) {
    elements.cellContent.textContent = snapshot.displayText;
    return;
  }

  renderRunsToEditor(snapshot.textRuns);
}

function renderRunsToEditor(runs: Excel.RangeTextRun[]): void {
  elements.cellContent.replaceChildren();
  runs.forEach((run) => {
    const span = document.createElement("span");
    span.textContent = run.text;
    span.dataset.excelFont = JSON.stringify(run.font ?? {});
    applyFontToElement(span, run.font);
    elements.cellContent.appendChild(span);
  });
}

function configureEditingMode(snapshot: CellSnapshot): void {
  elements.cellContent.contentEditable = snapshot.canEdit ? "true" : "false";
  elements.cellContent.classList.toggle("is-readonly", !snapshot.canEdit);

  const toolbarControls: HTMLButtonElement[] = [
    elements.boldButton,
    elements.italicButton,
    elements.underlineButton,
    elements.clearFormatButton,
    ...elements.colorSwatches,
  ];
  toolbarControls.forEach((control) => {
    control.disabled = !snapshot.canEdit;
  });
  if (!snapshot.canEdit) {
    elements.editModeBadge.textContent = snapshot.editReason;
    elements.editModeBadge.classList.add("is-warning");
  } else if (supportsRichText()) {
    elements.editModeBadge.textContent = "选中文字可设置格式 · 自动保存";
    elements.editModeBadge.classList.remove("is-warning");
  } else {
    elements.editModeBadge.textContent = "兼容模式：格式应用到整个单元格";
    elements.editModeBadge.classList.add("is-warning");
  }
}

function handleEditorInput(): void {
  if (!currentCanEdit) {
    return;
  }

  markEditorDirty();
  const text = getEditorText();
  elements.cellContent.classList.toggle("is-empty", text.length === 0);
  updateCharacterCount(text);
  elements.copyButton.disabled = text.length === 0;
  currentDisplayText = text;
}

function handleEditorKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || !currentCanEdit) {
    return;
  }
  event.preventDefault();
  insertPlainTextAtSelection("\n");
}

function handleEditorPaste(event: ClipboardEvent): void {
  if (!currentCanEdit) {
    return;
  }
  const text = event.clipboardData?.getData("text/plain");
  if (text === undefined) {
    return;
  }
  event.preventDefault();
  insertPlainTextAtSelection(text.replace(/\r\n?/g, "\n"));
}

function insertPlainTextAtSelection(text: string): void {
  restoreEditorSelection();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    elements.cellContent.focus();
    return;
  }

  const range = selection.getRangeAt(0);
  if (!elements.cellContent.contains(range.commonAncestorContainer)) {
    return;
  }

  range.deleteContents();
  const textNode = document.createTextNode(text);
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  savedEditorSelection = range.cloneRange();
  handleEditorInput();
}

function markEditorDirty(): void {
  editorDirty = true;
  elements.saveButton.textContent = "保存";
  elements.saveButton.disabled = false;
  elements.statusLine.textContent = "有尚未同步的修改";
  elements.statusLine.classList.remove("is-warning");

  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    void saveEditorChanges();
  }, 700);
}

async function flushPendingSave(): Promise<void> {
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  if (editorDirty) {
    await saveEditorChanges();
  }
}

async function saveEditorChanges(target: CellTarget | null = activeTarget): Promise<void> {
  if (saveInFlight) {
    await saveInFlight;
    return;
  }

  saveInFlight = performEditorSave(target);
  try {
    await saveInFlight;
  } finally {
    saveInFlight = null;
  }
}

async function performEditorSave(target: CellTarget | null): Promise<void> {
  if (!editorDirty || !currentCanEdit || !target) {
    return;
  }

  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }

  const runs = supportsRichText() ? getEditorTextRuns() : [];
  const text = supportsRichText() ? runs.map((run) => run.text).join("") : getEditorText();
  if (countCharacters(text) > 32767) {
    elements.statusLine.textContent = "内容超过 Excel 单元格的 32,767 字符限制，尚未保存";
    elements.statusLine.classList.add("is-warning");
    return;
  }

  elements.saveButton.textContent = "保存中…";
  elements.saveButton.disabled = true;
  isWritingToExcel = true;

  try {
    await Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getItem(target.sheetId);
      const cell = sheet.getRange(target.address);

      if (supportsRichText() && runs.length > 0) {
        const properties: Excel.SettableCellProperties = { textRuns: runs };
        cell.setCellProperties([[properties]]);
      } else {
        cell.values = [[text]];
      }

      await context.sync();
    });

    editorDirty = false;
    currentDisplayText = text;
    elements.rawValue.textContent = text || "（空）";
    elements.valueType.textContent = text ? "文本" : "空单元格";
    elements.saveButton.textContent = "已保存";
    elements.saveButton.disabled = true;
    elements.statusLine.textContent = "已同步到 Excel 单元格";
    elements.statusLine.classList.remove("is-warning");
  } catch (error) {
    editorDirty = true;
    elements.saveButton.textContent = "重试保存";
    elements.saveButton.disabled = false;
    elements.statusLine.textContent = friendlyErrorMessage(error instanceof Error ? error.message : String(error));
    elements.statusLine.classList.add("is-warning");
  } finally {
    isWritingToExcel = false;
  }
}

function applySelectionFormat(action: InlineFormatAction): void {
  if (!currentCanEdit) {
    return;
  }

  const offsets = getSavedSelectionOffsets();
  if (!offsets || offsets.start === offsets.end) {
    elements.statusLine.textContent = "请先在内容区选中要设置格式的文字";
    elements.statusLine.classList.add("is-warning");
    return;
  }

  const runs = getEditorTextRuns();
  const updatedRuns = applyFormatToRunRange(runs, offsets.start, offsets.end, action);
  renderRunsToEditor(updatedRuns);
  setEditorSelectionOffsets(offsets.start, offsets.end);
  currentDisplayText = updatedRuns.map((run) => run.text).join("");
  markEditorDirty();
  elements.statusLine.textContent = formatActionMessage(action);
  updateToolbarState();
  void saveEditorChanges();
}

function applyFormatToRunRange(
  runs: Excel.RangeTextRun[],
  selectionStart: number,
  selectionEnd: number,
  action: InlineFormatAction,
): Excel.RangeTextRun[] {
  const selectedFonts: Excel.CellPropertiesFont[] = [];
  let cursor = 0;
  runs.forEach((run) => {
    const runEnd = cursor + run.text.length;
    if (runEnd > selectionStart && cursor < selectionEnd) {
      selectedFonts.push(run.font ?? {});
    }
    cursor = runEnd;
  });

  const toggledValue =
    action.type === "toggle"
      ? !selectedFonts.every((font) => isFontPropertyActive(font, action.property))
      : false;

  const output: Excel.RangeTextRun[] = [];
  cursor = 0;
  runs.forEach((run) => {
    const runStart = cursor;
    const runEnd = runStart + run.text.length;
    const overlapStart = Math.max(runStart, selectionStart);
    const overlapEnd = Math.min(runEnd, selectionEnd);

    if (overlapStart >= overlapEnd) {
      appendRun(output, run.text, run.font ?? {});
      cursor = runEnd;
      return;
    }

    const beforeLength = overlapStart - runStart;
    const selectedLength = overlapEnd - overlapStart;
    appendRun(output, run.text.slice(0, beforeLength), run.font ?? {});
    appendRun(
      output,
      run.text.slice(beforeLength, beforeLength + selectedLength),
      updatedFontForAction(run.font ?? {}, action, toggledValue),
    );
    appendRun(output, run.text.slice(beforeLength + selectedLength), run.font ?? {});
    cursor = runEnd;
  });
  return output;
}

function updatedFontForAction(
  currentFont: Excel.CellPropertiesFont,
  action: InlineFormatAction,
  toggledValue: boolean,
): Excel.CellPropertiesFont {
  if (action.type === "clear") {
    return {};
  }
  if (action.type === "color") {
    return { ...currentFont, color: action.color };
  }
  if (action.property === "underline") {
    return {
      ...currentFont,
      underline: toggledValue ? Excel.RangeUnderlineStyle.single : Excel.RangeUnderlineStyle.none,
    };
  }
  return { ...currentFont, [action.property]: toggledValue };
}

function isFontPropertyActive(font: Excel.CellPropertiesFont, property: "bold" | "italic" | "underline"): boolean {
  if (property === "underline") {
    return Boolean(font.underline) && String(font.underline).toLowerCase() !== "none";
  }
  return font[property] === true;
}

function formatActionMessage(action: InlineFormatAction): string {
  if (action.type === "color") return "文字颜色已应用，正在同步到 Excel…";
  if (action.type === "clear") return "所选文字格式已清除，正在同步到 Excel…";
  return "文字格式已应用，正在同步到 Excel…";
}

function getSavedSelectionOffsets(): { start: number; end: number } | null {
  const range = savedEditorSelection;
  if (
    !range ||
    !elements.cellContent.contains(range.startContainer) ||
    !elements.cellContent.contains(range.endContainer)
  ) {
    return null;
  }

  const startRange = document.createRange();
  startRange.selectNodeContents(elements.cellContent);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = document.createRange();
  endRange.selectNodeContents(elements.cellContent);
  endRange.setEnd(range.endContainer, range.endOffset);
  const start = startRange.toString().length;
  const end = endRange.toString().length;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function setEditorSelectionOffsets(start: number, end: number): void {
  const startPoint = textPointAtOffset(start);
  const endPoint = textPointAtOffset(end);
  if (!startPoint || !endPoint) {
    return;
  }
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  savedEditorSelection = range.cloneRange();
}

function textPointAtOffset(targetOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(elements.cellContent, NodeFilter.SHOW_TEXT);
  let remaining = targetOffset;
  let lastNode: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    lastNode = node;
    const length = node.data.length;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
  }
  return lastNode ? { node: lastNode, offset: lastNode.data.length } : null;
}

async function applyWholeCellFont(patch: Partial<WholeCellFont>): Promise<void> {
  if (!currentCanEdit || !activeTarget) {
    return;
  }

  const target = activeTarget;
  isWritingToExcel = true;
  try {
    await Excel.run(async (context) => {
      const cell = context.workbook.worksheets.getItem(target.sheetId).getRange(target.address);
      if (patch.bold !== undefined) cell.format.font.bold = patch.bold;
      if (patch.color !== undefined) cell.format.font.color = patch.color;
      if (patch.italic !== undefined) cell.format.font.italic = patch.italic;
      if (patch.underline !== undefined) cell.format.font.underline = patch.underline as Excel.RangeUnderlineStyle;
      await context.sync();
    });
    currentWholeCellFont = { ...currentWholeCellFont, ...patch };
    elements.statusLine.textContent = "格式已应用到整个单元格";
    updateToolbarState();
  } catch (error) {
    elements.statusLine.textContent = friendlyErrorMessage(error instanceof Error ? error.message : String(error));
    elements.statusLine.classList.add("is-warning");
  } finally {
    isWritingToExcel = false;
  }
}

function preserveEditorSelection(event: MouseEvent): void {
  if ((event.currentTarget as HTMLElement).tagName !== "INPUT") {
    event.preventDefault();
  }
  saveEditorSelection();
}

function handleDocumentSelectionChange(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (elements.cellContent.contains(range.commonAncestorContainer)) {
    savedEditorSelection = range.cloneRange();
    updateToolbarState();
  }
}

function saveEditorSelection(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (elements.cellContent.contains(range.commonAncestorContainer)) {
    savedEditorSelection = range.cloneRange();
  }
}

function restoreEditorSelection(): void {
  if (!savedEditorSelection) {
    return;
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(savedEditorSelection);
}

function updateToolbarState(): void {
  if (!currentCanEdit) {
    [elements.boldButton, elements.italicButton, elements.underlineButton].forEach((button) => {
      button.classList.remove("is-active");
    });
    elements.colorSwatches.forEach((swatch) => swatch.classList.remove("is-active"));
    return;
  }

  if (supportsRichText()) {
    const selectedFonts = getSelectedFonts();
    elements.boldButton.classList.toggle(
      "is-active",
      selectedFonts.length > 0 && selectedFonts.every((font) => isFontPropertyActive(font, "bold")),
    );
    elements.italicButton.classList.toggle(
      "is-active",
      selectedFonts.length > 0 && selectedFonts.every((font) => isFontPropertyActive(font, "italic")),
    );
    elements.underlineButton.classList.toggle(
      "is-active",
      selectedFonts.length > 0 && selectedFonts.every((font) => isFontPropertyActive(font, "underline")),
    );
    const selectedColor =
      selectedFonts.length > 0 && selectedFonts.every((font) => normalizeColor(font.color || "#000000") === normalizeColor(selectedFonts[0].color || "#000000"))
        ? normalizeColor(selectedFonts[0].color || "#000000")
        : "";
    elements.colorSwatches.forEach((swatch) => {
      swatch.classList.toggle("is-active", normalizeColor(swatch.dataset.color || "") === selectedColor);
    });
  } else {
    elements.boldButton.classList.toggle("is-active", currentWholeCellFont.bold);
    elements.italicButton.classList.toggle("is-active", currentWholeCellFont.italic);
    elements.underlineButton.classList.toggle(
      "is-active",
      String(currentWholeCellFont.underline).toLowerCase() !== "none",
    );
    elements.colorSwatches.forEach((swatch) => {
      swatch.classList.toggle(
        "is-active",
        normalizeColor(swatch.dataset.color || "") === normalizeColor(currentWholeCellFont.color),
      );
    });
  }
}

function getSelectedFonts(): Excel.CellPropertiesFont[] {
  const offsets = getSavedSelectionOffsets();
  if (!offsets || offsets.start === offsets.end) {
    return [];
  }
  const fonts: Excel.CellPropertiesFont[] = [];
  let cursor = 0;
  getEditorTextRuns().forEach((run) => {
    const runEnd = cursor + run.text.length;
    if (runEnd > offsets.start && cursor < offsets.end) {
      fonts.push(run.font ?? {});
    }
    cursor = runEnd;
  });
  return fonts;
}

function getEditorTextRuns(): Excel.RangeTextRun[] {
  if (elements.cellContent.textContent === "" && elements.cellContent.querySelectorAll("br").length <= 1) {
    return [];
  }

  const runs: Excel.RangeTextRun[] = [];
  const rootFont: Excel.CellPropertiesFont = {};
  Array.from(elements.cellContent.childNodes).forEach((child, index, siblings) => {
    appendNodeRuns(child, rootFont, runs);
    if (isBlockElement(child) && index < siblings.length - 1) {
      appendRun(runs, "\n", rootFont);
    }
  });
  return runs;
}

function appendNodeRuns(node: Node, inheritedFont: Excel.CellPropertiesFont, runs: Excel.RangeTextRun[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    appendRun(runs, node.textContent ?? "", inheritedFont);
    return;
  }

  if (!(node instanceof HTMLElement)) {
    return;
  }

  if (node.tagName === "BR") {
    appendRun(runs, "\n", inheritedFont);
    return;
  }

  const font = readElementFont(node, inheritedFont);
  Array.from(node.childNodes).forEach((child, index, siblings) => {
    appendNodeRuns(child, font, runs);
    if (isBlockElement(child) && index < siblings.length - 1) {
      appendRun(runs, "\n", font);
    }
  });
}

function appendRun(runs: Excel.RangeTextRun[], text: string, font: Excel.CellPropertiesFont): void {
  if (text.length === 0) {
    return;
  }
  const normalizedFont = compactFont(font);
  const previous = runs.at(-1);
  if (previous && JSON.stringify(previous.font ?? {}) === JSON.stringify(normalizedFont)) {
    previous.text += text;
  } else {
    runs.push({ text, font: normalizedFont });
  }
}

function readElementFont(element: HTMLElement, inherited: Excel.CellPropertiesFont): Excel.CellPropertiesFont {
  let font: Excel.CellPropertiesFont = { ...inherited };
  const storedFont = element.dataset.excelFont;
  if (storedFont) {
    try {
      font = { ...font, ...(JSON.parse(storedFont) as Excel.CellPropertiesFont) };
    } catch {
      // Ignore invalid data attributes created outside the add-in.
    }
  }

  const tag = element.tagName;
  if (tag === "B" || tag === "STRONG") font.bold = true;
  if (tag === "I" || tag === "EM") font.italic = true;
  if (tag === "U") font.underline = Excel.RangeUnderlineStyle.single;
  if (element.style.fontWeight) font.bold = element.style.fontWeight === "bold" || Number(element.style.fontWeight) >= 600;
  if (element.style.fontStyle) font.italic = element.style.fontStyle === "italic";
  if (element.style.textDecorationLine.includes("underline")) font.underline = Excel.RangeUnderlineStyle.single;

  const inlineColor = element.getAttribute("color") || element.style.color;
  if (inlineColor) font.color = normalizeColor(inlineColor);
  return font;
}

function compactFont(font: Excel.CellPropertiesFont): Excel.CellPropertiesFont {
  return Object.fromEntries(Object.entries(font).filter(([, value]) => value !== undefined && value !== null)) as Excel.CellPropertiesFont;
}

function isBlockElement(node: Node): boolean {
  return node instanceof HTMLElement && ["DIV", "P"].includes(node.tagName);
}

function getEditorText(): string {
  return getEditorTextRuns().map((run) => run.text).join("");
}

function applyFontToElement(element: HTMLElement, font?: Excel.CellPropertiesFont): void {
  if (!font) return;
  if (font.bold !== undefined) element.style.fontWeight = font.bold ? "700" : "400";
  if (font.italic !== undefined) element.style.fontStyle = font.italic ? "italic" : "normal";
  if (font.color) element.style.color = font.color;
  if (font.name) element.style.fontFamily = font.name;
  if (font.size) element.style.fontSize = `${font.size}pt`;
  if (font.underline && String(font.underline).toLowerCase() !== "none") element.style.textDecoration = "underline";
  if (font.strikethrough) element.style.textDecoration = `${element.style.textDecoration} line-through`.trim();
}

async function copyCurrentContent(): Promise<void> {
  const text = currentCanEdit ? getEditorText() : currentDisplayText;
  if (!text) {
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopy(text);
    }
    showCopyFeedback("已复制");
  } catch {
    try {
      fallbackCopy(text);
      showCopyFeedback("已复制");
    } catch {
      showCopyFeedback("复制失败");
    }
  }
}

function fallbackCopy(value: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const succeeded = document.execCommand("copy");
  textarea.remove();

  if (!succeeded) {
    throw new Error("Copy command failed");
  }
}

function showCopyFeedback(message: string): void {
  elements.copyLabel.textContent = message;
  if (copyResetTimer !== undefined) {
    window.clearTimeout(copyResetTimer);
  }
  copyResetTimer = window.setTimeout(() => {
    elements.copyLabel.textContent = "复制";
  }, 1400);
}

function updateCharacterCount(text: string): void {
  elements.characterCount.textContent = `${countCharacters(text).toLocaleString("zh-CN")} 个字符`;
}

function setBusy(isBusy: boolean): void {
  elements.refreshButton.classList.toggle("is-spinning", isBusy);
  elements.refreshButton.disabled = isBusy;
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  elements.errorMessage.textContent = friendlyErrorMessage(message);
  showOnly(elements.error);
  setBusy(false);
}

function friendlyErrorMessage(message: string): string {
  if (/InvalidObjectPath|GeneralException/i.test(message)) {
    return "单元格状态刚刚发生变化，请重新选择或点击重试。";
  }
  if (/permission|access/i.test(message)) {
    return "当前工作簿不允许更新此单元格。";
  }
  return `操作失败：${message}`;
}

function showOnly(target: HTMLElement): void {
  [elements.loading, elements.unsupported, elements.error, elements.reader].forEach((section) => {
    section.classList.toggle("is-hidden", section !== target);
  });
}

function getEditability(rawValue: unknown, formulaText: string): { canEdit: boolean; reason: string } {
  if (formulaText) return { canEdit: false, reason: "公式单元格为只读，避免覆盖公式" };
  if (typeof rawValue === "string") return { canEdit: true, reason: "" };
  if (rawValue === null || rawValue === undefined) return { canEdit: true, reason: "" };
  return { canEdit: false, reason: "当前类型为只读；文本和空单元格可编辑" };
}

function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function describeValueType(value: unknown): string {
  if (value === "" || value === null || value === undefined) return "空单元格";
  if (typeof value === "number") return "数值";
  if (typeof value === "boolean") return "布尔值";
  if (typeof value === "object") return "丰富数据类型";
  return "文本";
}

function isFormula(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("=");
}

function countCharacters(value: string): number {
  return Array.from(value).length;
}

function shortAddress(address: string): string {
  const separatorIndex = address.lastIndexOf("!");
  return separatorIndex >= 0 ? address.slice(separatorIndex + 1) : address;
}

function normalizeColor(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toUpperCase();
  }
  const rgb = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((component) => Number(component).toString(16).padStart(2, "0"))
      .join("")}`.toUpperCase();
  }
  return "#000000";
}

function defaultWholeCellFont(): WholeCellFont {
  return {
    bold: false,
    color: "#000000",
    italic: false,
    underline: Excel.RangeUnderlineStyle.none,
  };
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element as T;
}

function requiredElements<T extends HTMLElement>(selector: string): T[] {
  const elements = Array.from(document.querySelectorAll<T>(selector));
  if (elements.length === 0) {
    throw new Error(`Missing required elements: ${selector}`);
  }
  return elements;
}
