#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
PROJECT_DIR="${SCRIPT_DIR:h}"
EXCEL_WEF_DIR="${HOME}/Library/Containers/com.microsoft.Excel/Data/Documents/wef"
TARGET_MANIFEST="${EXCEL_WEF_DIR}/cell-reader-manifest.xml"

mkdir -p "${EXCEL_WEF_DIR}"
cp "${PROJECT_DIR}/manifest.xml" "${TARGET_MANIFEST}"

echo "已安装加载项清单：${TARGET_MANIFEST}"
echo "下一步：保持 npm start 正在运行，然后完全退出并重新打开 Excel。"
echo "在 Excel 的“开始”选项卡中点击“查看完整内容”。"
