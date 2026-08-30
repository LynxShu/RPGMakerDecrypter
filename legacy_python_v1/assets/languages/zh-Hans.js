var lang_zh_hans = {
	// ===== 基本信息 =====
	'languageName': 'Chinese (Simplified)',
	'localizedLanguageName': '简体中文',
	'flagAltText': 'China Flag',
	'htmlLang': 'zh-Hans',

	// 元信息
	'title': 'RPG Maker MV/MZ 资源加解密工具',

	// 顶部标题
	'header.title': 'RPG Maker MV/MZ 资源加解密工具',

	// 导航栏
	'tab.restoreImages': '无密钥还原图像',

	// UI 元素与按钮
	'files.dragAndDrop': '拖拽文件或文件夹到此处',
	'button.clearFiles': '清空列表',
	'button.start': '开始处理',

	// 表单与功能区
	'enDecrypt.formBox.decryptCode': '解密密钥 (Key)',
	'enDecrypt.formBox.advanced': '高级设置',

	// Labels
	'enDecrypt.label.header.length': '头长度 (Bytes) {0}',
	'enDecrypt.label.header.signature': '签名 (Signature)',
	'enDecrypt.label.header.version': '版本 (Version)',
	'enDecrypt.label.header.remain': '保留位 (Remain)',
	'enDecrypt.label.verifyHeader.no': '忽略 (强行解密)',

	// Buttons
	'enDecrypt.button.detect': '自动检测',
	'enDecrypt.button.decrypt': '资源解密',
	'enDecrypt.content.header.encryption': '资源加密',

	// 错误与提示信息
	'exception.emptyFile': '文件为空或无法读取。',
	'exception.fileTooShort': '文件太短。',
	'exception.invalidFakeHeader.1': '文件头与预设不匹配。',
	'error.enDecrypt.noCode': '请输入解密密钥!',

	// Tooltips 
	'tooltip.content.gameDir': '选择游戏根目录 (包含 www 文件夹)',

	// === UI 专用 ===
	'status.ready': '准备就绪',
	'status.processing': '正在处理: {0}/{1} ({2})',
	'status.addedFiles': '已添加 {0} 个文件。',
	'status.listCleared': '列表已清空。',
	'status.keyDetected': '密钥检测成功。',
	'status.keyFailed': '密钥检测失败。',
	'status.stopping': '正在停止...',
	'status.done': '完成。{0}',
	'status.noFiles': '列表为空 (未添加文件)',
	'status.processing_simple': '正在处理 {0} ({1})',

	'preview.noPreview': '[无预览]',
	'preview.notImage': '[非图像文件]',
	'preview.enterKey': '[输入密钥以预览]',
	'preview.decryptFailed': '[解密失败]',
	'preview.previewError': '[预览错误]',

	'col.fileName': '文件名',
	'col.type': '类型',
	'col.size': '大小',
	'col.status': '状态',
	'status.pending': '等待中',

	'ui.appearance': '外观模式:',
	'ui.theme.light': '浅色',
	'ui.theme.dark': '深色',
	'ui.theme.system': '跟随系统',

	'log.systemReady': '系统已就绪。',
	'ui.menu.file': '文件',
	'ui.menu.help': '帮助',

	'ui.logo': 'RMMV/MZ\n解密工具',
	'ui.ver': '版本:',
	'ui.cancel': '取消',
	'ui.openOutput': '打开输出文件夹',
	'ui.moreFiles': '... 还有 {0} 个文件',
	'ui.imagesOnly': '(仅限图像)',

	// === Worker Log Keys ===
	'mode.decrypt': '解密',
	'mode.encrypt': '加密',
	'mode.restore': '还原',
	'log.starting': '开始 {0} 任务，共 {1} 个文件...',
	'log.cancelled': '操作已取消。',
	'log.outputDirError': '无法创建输出目录: {0}',
	'log.success': '成功: {0} -> {1}',
	'log.processError': '处理 {0} 时出错: {1}',
	'log.finished': '完成。已处理: {0}, 成功: {1}。耗时: {2}秒',
}
