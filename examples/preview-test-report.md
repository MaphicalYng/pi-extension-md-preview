# md-preview 插件测试报告

> 本文件是 `pi-extension-md-preview` 的**渲染测试样例**，覆盖插件声明支持的全部 Markdown 特性。
> 用于验证：页面排版、目录导航、代码高亮与复制、表格、提示框、任务列表、图片/链接路由、实时刷新等。

## 测试清单速览

| 测试项 | 语法 | 预期效果 |
| :--- | :--- | :--- |
| 标题与目录 | `#` ~ `######` | 右侧 TOC 高亮、锚点 `#` 链接 |
| 行内样式 | **粗体** *斜体* ~~删除线~~ `行内代码` | 各自独立样式 |
| 表格 | GFM 表格 | 左/中/右对齐、横向滚动 |
| 代码块 | 围栏代码 | 语言标签 + 一键复制 + 高亮 |
| 提示框 | `> [!NOTE]` | 彩色 callout |
| 任务列表 | `- [x]` | 复选框渲染 |
| 链接路由 | 相对 md / 锚点 / 外链 | 同页打开 / 页内跳转 / 新标签 |
| 图片资源 | `![](相对路径)` | 静态资源服务加载 |
| 转义与安全 | HTML 尖括号 | 原样转义、不执行脚本 |

## 一、行内样式与自动链接

这是一段普通段落，包含 **粗体**、*斜体*、***粗斜体***、~~删除线~~、`inline code`，
以及一个裸自动链接 <https://github.com/earendil-works/pi-coding-agent> 和一个
[带标题的外部链接](https://developer.mozilla.org/zh-CN/docs/Web/JavaScript "外部链接：新标签打开")。
另外测试页内锚点跳转：[跳到「五、代码块」](#五代码块)。

> 段落中的长文本换行不应产生硬换行（`breaks: false`），
> 这一行应当与上一行连排在同一段落中显示。

## 二、列表与任务列表

1. 有序列表第一项
2. 有序列表第二项
   1. 嵌套有序列表
   2. 嵌套第二项
3. 有序列表第三项

- 无序列表 A
  - 嵌套 A-1（含 `code` 片段）
  - 嵌套 A-2
- 无序列表 B

- [x] 存储层迁移
- [x] 缓存引入
- [ ] 离线任务切换（预计下季度）
- [ ] 转义测试：`- [ ]` 中的括号不应被吞掉

## 三、表格与对齐

| 指标 | 迁移前 | 迁移后 | 变化 | 备注 |
| :--- | ---: | ---: | :---: | :--- |
| P99 延迟 | 840 ms | 580 ms | -31% | 左对齐列 |
| 错误率 | 0.42% | 0.11% | -74% | 右对齐数值列 |
| 单位成本 | ¥1.80 | ¥1.20 | -33% | 居中列 |
| 覆盖索引命中 | 61% | 92% | +31pp | 含 `code` 的单元格 |

窄屏时表格应出现横向滚动而不是撑破版心。

## 四、引用块与提示框

> 这是一段普通引用块。
> 可以跨行书写，用于引用外部结论或历史背景。

> [!NOTE]
> 这是 NOTE 提示框：上限 8 秒的退避窗口是基于现网重放数据确定的。

> [!WARNING]
> 这是 WARNING 提示框：迁移期间请勿在未加缓存的情况下直连旧存储。

> [!TIP]
> 这是 TIP 提示框：开发调试可直接 `pi --extension extensions/md-preview/index.ts` 临时加载。

## 五、代码块

验证点：语言标签、一键复制按钮、语法高亮、转义字符。

```typescript
export async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let error: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      error = err;
      await sleep(Math.min(1000 * 2 ** i, 8000) * (0.5 + Math.random()));
    }
  }
  throw error;
}
```

```python
from dataclasses import dataclass

@dataclass
class Metric:
    name: str
    before: float
    after: float

    @property
    def delta(self) -> float:
        return (self.after - self.before) / self.before

print(f"P99 变化: {Metric('p99', 840, 580).delta:.0%}")  # -31%
```

```bash
# 安装并临时加载本插件
pi install /Users/maphicalyng/code/mk_projects/pi-extension-md-preview
pi --extension extensions/md-preview/index.ts
```

```json
{
  "file": "examples/preview-test-report.md",
  "title": "md-preview 插件测试报告",
  "open_browser": true
}
```

```text
无语言标注的代码块：语言标签应显示为 text，不高亮。
特殊字符转义测试：<script>alert("xss")</script> & < > " '
```

## 六、链接路由与图片资源

- 相对 Markdown 链接（应在预览内同页打开新文档）：[项目 README](../README.md)
- 页内锚点链接：[回到测试清单](#测试清单速览)
- 外部链接（应在新标签打开）：[TypeBox](https://github.com/sinclairzx81/typebox)

图片资源（相对路径，走静态资源服务；带 title 提示）：

![md-preview 数据流示意图](./preview-test-image.svg "图片 title：悬停提示文本")

## 七、转义与安全

以下内容必须**原样显示**、不得被解析为 HTML 或执行：

- 标签转义：`<script>alert("xss")</script>` 与裸文本 <script>alert("xss")</script>
- 实体转义：`&amp;` `<` `>` `"` `'`
- 表格竖线转义：`\|` 在单元格内显示为 `|`

---

## 八、滚动与导航长文测试

以下为重复性长文本，用于验证：页面顶部进度条、TOC 滚动高亮、「回到顶部」按钮、主题切换平滑过渡。

### 8.1 背景

在多标签页阅读场景下，渲染页面需要保证长文档的滚动体验流畅。目录导航应当随滚动位置
高亮当前小节，指示器平滑滑动；页面顶部的进度条应随阅读位置增长；当滚动超过一屏后，
右下角应浮出「回到顶部」按钮。本小节刻意保持一定篇幅，以产生可滚动的页面高度。

### 8.2 方案

渲染层只负责把 Markdown 转成语义化 HTML，交互层（TOC 高亮、进度条、复制按钮）由页面
脚本渐进增强完成；即使脚本未执行，文档内容也应可读。这一设计保证了打印、无头冒烟测试
与无障碍阅读三种场景下的一致性。

### 8.3 观测指标

滚动性能以帧率为观测口径；样式切换以 CSS transition 覆盖率为口径；代码复制以 clipboard
API 成功率为口径。三项指标均应在开发工具的 Performance 面板中肉眼可辨地达标，无需额外
埋点系统。重复段落：渲染层只负责把 Markdown 转成语义化 HTML，交互层由页面脚本渐进增强
完成；即使脚本未执行，文档内容也应可读。重复段落：渲染层只负责把 Markdown 转成语义化
HTML，交互层由页面脚本渐进增强完成；即使脚本未执行，文档内容也应可读。

### 8.4 风险

长文档下 TOC 条目过多时应可滚动；重复标题（见下）应生成去重后的锚点 id（如 `-1` 后缀），
锚点链接不得互相冲突。实时刷新（SSE）在本文件被编辑后应自动重载页面，且刷新有淡入效果。

### 8.5 重复标题

用于测试 slug 去重（两个同名标题）。

### 8.5 重复标题

第二个同名标题：其锚点 id 应带去重后缀，且两处锚点互不覆盖。

### 8.6 结论

本样例文件覆盖了插件的全部声明特性；逐项核对上方「测试清单速览」表格即可完成验收。
若某一项渲染异常，可直接编辑本文件触发实时刷新复测，无需重新调用工具。

---

*文档结束 · 由测试样例生成 · 末尾空行不应产生多余间距*
