# shiguang_warehouse  

本仓库用于管理 [shiguangschedule](https://github.com/XingHeYuZhuan/shiguangschedule) 的适配脚本，供软件拉取和测试。  

## 开发适配需要的工具和文档  
- **[如何适配教务](https://github.com/XingHeYuZhuan/shiguangschedule/wiki)**  
- **[浏览器测试插件](https://github.com/XingHeYuZhuan/shiguang_Tester)**  

> [!important]
> **为避免代码出现问题，`main` 分支已启用分支保护，需要先合并到 `pending` 分支等待分支同步。**

## 仓库结构

```
shiguang_warehouse/
├───.github/
│   ├───workflows/
│   │   ├───build-index.yml  # 生成 Protobuf 数据索引
│   │   └───...
│   └───...
├───index/
│   └───root_index.yaml      # 整个适配器仓库的根索引文件
├───resources/               # 资源目录
│   ├───GLOBAL_TOOLS/        # 通用工具目录(目录名称和index规定的一致)
│   │   ├───adapters.yaml    # 学校适配器配置信息(可以存放多个适配器)
│   │   ├───school.js        # 适配代码(javascript文件，与学校适配器配置信息对应)   
│   │   └───...
│   └───...
├───proto/
|   └───school_index.proto #索引模板文件 可使用protoc等工具编译为其他平台代码用于解析仓库索引
└───...
```

## root_index.yaml 字段说明

**每个条目需包含以下字段：**

| 字段名            | 类型      | 说明                       |
| ----------------- | --------- | -------------------------- |
| `id`              | `string`  | 唯一标识（拼音或缩写，如果可以更建议使用域名）<br>一般来说我们建议教务使用全大写，工具使用全小写 |
| `name`            | `string`  | 中文名称                   |
| `initial`         | `string`  | 名称首字母（用于排序）     |
| `resource_folder` | `string`  | 资源文件夹名称（建议和 `id` 保持一致）|

**示例：**
```yaml
schools: #固定字段
  - id: "GLOBAL_TOOLS"
    name: "通用工具与服务"
    initial: "T"
    resource_folder: "GLOBAL_TOOLS"

  - id: "CUST"
    name: "长春理工大学"
    initial: "C"
    resource_folder: "CUST"
```

> [!note]
> 新增学校/工具时，先在 `root_index.yaml` 添加条目，再在 `resources/` 下创建与 `resource_folder` 字段一致的文件夹，放入 `adapters.yaml` 和适配脚本。**未登记的学校/工具无法提交适配文件。**

## adapters.yaml 配置说明

**每个适配器配置应包含以下字段（YAML格式，字段全部必填）：**

| 字段名          | 类型    | 说明                                          |
| --------------- | ------- | --------------------------------------------- |
| adapter_id      | string  | 唯一标识（建议用拼音或英文缩写），个人建议使用学校 id 加序号的形式 |
| adapter_name    | string  | 中文名称                                      |
| category        | string  | 分类：`BACHELOR_AND_ASSOCIATE`(本科/专科)、`POSTGRADUATE`(研究生)、`GENERAL_TOOL`(通用工具) |
| asset_js_path   | string  | 适配脚本的**相对路径**（如 `school.js`）      |
| import_url      | string  | 系统登录URL（教务系统适配器必填，工具可为空） |
| maintainer      | string  | 维护者信息（如姓名或 GitHub 用户名）          |
| description     | string  | 简要说明（如适配用途、备注等）                |

**示例：**
```yaml
adapters: #固定字段
  - adapter_id: "GENERAL_TOOL_01" # id加上序号
    adapter_name: "组件测试"
    category: "GENERAL_TOOL"
    asset_js_path: "school.js" #相对路径
    import_url: ""
    maintainer: "星河欲转"
    description: "这是一个空网站，用于组件测试与演示模式"
```

> [!important] 
> - 请严格按照上述字段填写，不要添加或减少字段。
> - `import_url` 一定要是登录页面。
> - `asset_js_path` 填写对应学校的适配脚本**相对路径**。
> - `maintainer` 填写维护者信息，便于后续沟通和维护。

## 开发流程

```
Fork 本仓库 → 在 index/root_index.yaml 文件中登记 → 在 resources 目录创建学校文件夹 → 创建 adapters.yaml 和适配脚本 → 推送到自己仓库并充分测试 → 提交 PR 到上游 pending 分支等待合并
```

### 添加适配代码
> [!note]
> 在**不更新索引**的情况下，修改任何 yaml 文件是没有作用的（任何对于 yaml 文件的修改都需要编译索引才能应用），所以才提供了 asset_js_path: `test.js` 占位，用于在不更新索引的情况下测试适配代码

- Fork 仓库之后，建议测试代码不要在自己的主分支测试哦，可以在仓库再开一个测试分支，测试完成可以一次将正确的代码提交到主分支，这样你的提交历史就不会充斥错误的提交历史
- 仓库更改数据结构后索引需要编译，软件只接收编译过的索引文件。所以如果要测试适配代码，建议创建 `resources\GLOBAL_TOOLS\test.js` 文件写入适配代码
- **注意提交 PR 请不要把测试的 `test.js` 也提交上去哦！！**

```yaml
- adapter_id: "GENERAL_TOOL_02"
  adapter_name: "适配代码测试"
  category: "GENERAL_TOOL"
  asset_js_path: "test.js"
  import_url: ""
  maintainer: "星河欲转"
  description: "空网站以及不存在适配代码，用于在不更新索引的情况下给开发者进行适配的软件测试"    
```  

## 关于仓库索引  
当前仓库下面的固定孤立分支index-pb-release承担存放索引的功能  
school_index.pb文件存放了适配仓库里面的所有yaml文件的信息，因此软件仅需要拉取该索引文件和resources资源目录下面的所有*.js文件  
`scripts\build_data.py`代码负责编译出school_index.pb文件
> 当前索引协议版本：v2

> [!tip]
> 如需更新索引，可自行了解仓库的 CI 配置（不建议测试适配时还更新索引）

### 软件测试
开发者需要在"更多"页面点击图标5次打开开发者功能，在软件的“我的-更多-更新仓库”中选择**自定义仓库或私有仓库**，来拉取并更新自己的仓库代码进行实际测试，完成 Beta 阶段适配验证。  
从2.x版本开始不在维护两个版本，开发者功能已合并至正式版本，在"更多"页面点击图标5次打开开发者功能

### 提交 PR
测试通过后，提交 Pull Request，等待审核合并。

## 社区公约
本项目基于 MIT 协议开源，致力于教务系统的适配与维护。为保障项目的良性流转，请在参与或使用本项目时遵守以下约定：

1. 贡献与署名

   我们感谢所有贡献者的无私分享，每一份适配代码都值得被尊重。在引用或二次开发时，请保留原始开发者的贡献记录（如 Git 提交历史）。这既是对他人劳动的认可，也是社区协作的基础。任何抹除或篡改记录的行为，均不符合社区规范。
2. 分支与免责声明
   - **适用范围**：本项目主要维护工作集中于官方仓库及官方分支。
   - **非官方项目**：任何脱离官方管理的第三方分支或衍生项目，其所有行为均与本项目官方无关。
   - **责任界定**：若第三方项目存在代码滥用、违规适配或分发不当，由此产生的一切后果均由该项目维护者自行承担。**本项目及无辜的原始贡献者不承担任何连带责任**。

## 注意事项

- 请确保 `adapters.yaml` 信息准确完整，符合规范要求。
- 每次提交适配代码或索引信息后，建议自测通过再提交 PR。


---  

如有问题或建议，欢迎提交 Issue 或 PR。
