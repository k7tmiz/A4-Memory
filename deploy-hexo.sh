#!/bin/bash
# 部署前端到 Hexo 站点
# 用法: ./deploy-hexo.sh

SRC="/Users/Katmai/A4-Memory"
DEST="$HOME/Hexo/source/words"

echo "📦 同步前端文件到 Hexo..."
echo "   $SRC → $DEST"

rsync -av --delete \
  --exclude='.git/' \
  --exclude='.gitignore' \
  --exclude='backend/' \
  --exclude='AGENTS.md' \
  --exclude='CLAUDE.md' \
  --exclude='LICENSE' \
  --exclude='README.md' \
  --exclude='docs/' \
  --exclude='.DS_Store' \
  --exclude='node_modules/' \
  --exclude='deploy-hexo.sh' \
  --exclude='deploy-backend.sh' \
  "$SRC/" "$DEST/"

echo ""
echo "✅ 同步完成"
echo ""
echo "🚀 开始 Hexo 部署..."
cd "$HOME/Hexo" && hexo clean && hexo g && hexo d
echo ""
echo "✅ 全部完成。站点已更新。"
