import fs from 'node:fs';

const path = 'F:\\Tools\\FrameX Feishu\\index.js';
const buf = fs.readFileSync(path);
let c = buf.toString('utf8');

// Map of exact visible garbled strings -> correct Chinese
// Use Buffer.from to avoid any encoding issues in this script itself
const garbledMap = new Map();
const add = (hex, correct) => {
  garbledMap.set(Buffer.from(hex.split(' ').map(h => parseInt(h, 16))).toString('utf8'), correct);
};

// These hex sequences are the garbled text found in the file
// They are the result of UTF-8 encoded Chinese being read as GBK then written back
add('e9 8f 84 e5 89 a7 e3 81 8a', '消息');
add('e9 9f 84 e5 89 a7 e3 82 8a', '消息'); // variant

// Re-read the file with the fix using byte-level approach
const fixed = [];
let i = 0;
const lines = c.split('\n');
let fixedCount = 0;

// Manual line-by-line fixes for corrupted Chinese text
// The pattern: find lines with garbled Chinese chars and replace them
const lineFixes = {};

// Scan for lines with Chinese and flag them
lines.forEach((line, idx) => {
  // Count bytes in the line that look like garbled multi-byte sequences
  const garbledCount = (line.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  // Count proper known Chinese characters
  const properChars = '是否自动添加时间戳可选truefalse默认签名来源客户端系统工具名消息ID发送失败创建文档文件夹链接错误获取要回复的内容撤回群聊名称描述成员删除查找用户信息部门列表日历事件记录列表任务更新完成标题截至协作者电子表格读取范围写入数据知识库节点空间父视频会议主题密码录制审批实例编码表单发起翻译文本目标源语言妙记Token添加失败已知方法根目录浏览文件夹文件类型手机号邮箱详细信息';
  const properCount = [...line].filter(ch => properChars.includes(ch)).length;
  
  if (garbledCount > 0 && properCount < garbledCount * 0.3) {
    // This line is garbled
    lineFixes[idx] = line;
  }
});

console.log(`Found ${Object.keys(lineFixes).length} garbled lines`);

// Now let's use a different strategy: replace using known correct patterns
// These are lines that we know are correct from the original code
const targetHex = 'e9' - incorrect prefix, let me just use string search

// Actually, let me just provide the correct version for each corrupted line
// I'll read each corrupted line and print its hex for analysis
let sampleCount = 0;
for (const [idx, line] of Object.entries(lineFixes)) {
  if (sampleCount < 3) {
    const lineBuf = Buffer.from(line, 'utf8');
    console.log(`Line ${+idx+1}: hex first 30 bytes:`, lineBuf.slice(0, 50).toString('hex').match(/.{1,2}/g).join(' '));
    sampleCount++;
  }
}

fs.writeFileSync(path, c, 'utf8');
console.log('Done');
