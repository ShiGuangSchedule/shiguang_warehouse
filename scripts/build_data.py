import sys
import yaml
import os
import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
# 确保该目录在模块搜索路径中
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


# --- 1. Protobuf 依赖导入 ---
# 注意：这依赖于 protoc 编译生成的 school_index_pb2.py 文件
try:
    from school_index_pb2 import SchoolIndex, School, Adapter, AdapterCategory 
except ImportError:
    print("错误：无法导入 Protobuf 模块 (school_index_pb2)。请确认文件已存在。")
    sys.exit(1)


# --- 2. 工程常量与版本定义 ---
# 协议版本：结构大改动时手动递增。
PROTOCOL_VERSION = 2 

# YAML 文件路径常量
ROOT_INDEX_PATH = Path("index/root_index.yaml")
RESOURCES_ROOT = Path("resources")
OUTPUT_PB_FILE = "school_index.pb"


# --- 3. 辅助函数：获取版本ID (用于 version_id 字段) ---
def get_version_id():
    """
    【统一标准】：只使用精确到毫秒的时间戳作为数据版本ID。
    """
    # 获取当前时间（包含微秒）
    now = datetime.datetime.now()
    
    # 格式化时间部分
    time_str = now.strftime("TIME_%Y%m%d%H%M%S")
    micro_str = f"{now.microsecond // 1000:03d}" 
    
    return f"{time_str}_{micro_str}"


# --- 4. 辅助函数：YAML 解析逻辑 ---
def get_adapter_category_enum(category_str):
    """将 YAML 字符串类别映射到 Protobuf 枚举值。"""
    enum_value = getattr(AdapterCategory, category_str, AdapterCategory.ADAPTER_CATEGORY_UNKNOWN)
    return enum_value

def parse_all_yaml():
    """解析所有 YAML 文件，返回结构化数据。"""
    if not ROOT_INDEX_PATH.exists():
        raise FileNotFoundError(f"根索引文件未找到: {ROOT_INDEX_PATH}")
    
    with open(ROOT_INDEX_PATH, 'r', encoding='utf-8') as f:
        root_data = yaml.safe_load(f)

    schools_data = root_data.get('schools', [])
    parsed_schools = []

    for school_entry in schools_data:
        # 1. 拼接 adapters.yaml 的路径
        folder_name = school_entry['resource_folder']
        adapter_yaml_path = RESOURCES_ROOT / folder_name / "adapters.yaml"

        if not adapter_yaml_path.exists():
            print(f"警告：未找到适配器配置 {adapter_yaml_path}，跳过学校 {school_entry['id']}")
            continue
            
        # 2. 读取适配器详情
        with open(adapter_yaml_path, 'r', encoding='utf-8') as f:
            adapter_data = yaml.safe_load(f)
            
        # 将适配器列表添加到学校数据中
        school_entry['adapters'] = adapter_data.get('adapters', [])
        parsed_schools.append(school_entry)

    return parsed_schools


# --- 5. 核心构建函数：数据映射与填充 ---
def build_protobuf_index(parsed_schools_data):
    """将解析后的数据填充到 Protobuf 消息中。"""
    index = SchoolIndex()
    # 设置顶层版本信息
    index.protocol_version = PROTOCOL_VERSION
    index.version_id = get_version_id() 

    for school_data in parsed_schools_data:
        # 1. 填充 School 消息
        school_msg = index.schools.add()
        school_msg.id = school_data.get('id', '')
        school_msg.name = school_data.get('name', '')
        school_msg.initial = school_data.get('initial', '')
        school_msg.resource_folder = school_data.get('resource_folder', '')

        # 2. 填充 Adapter 列表
        for adapter_data in school_data.get('adapters', []):
            adapter_msg = school_msg.adapters.add()
            
            # 填充普通 string 字段
            adapter_msg.adapter_id = adapter_data.get('adapter_id', '')
            adapter_msg.adapter_name = adapter_data.get('adapter_name', '')
            adapter_msg.asset_js_path = adapter_data.get('asset_js_path', '')
            adapter_msg.description = adapter_data.get('description', '')
            adapter_msg.maintainer = adapter_data.get('maintainer', '')

            # 填充 optional 字段：只有当字段不为 None 时才设置
            import_url = adapter_data.get('import_url')
            if import_url is not None:
                adapter_msg.import_url = import_url
            
            # 填充枚举字段
            category_str = adapter_data.get('category', 'ADAPTER_CATEGORY_UNKNOWN')
            adapter_msg.category = get_adapter_category_enum(category_str)

    return index


# --- 6. 主执行流程 ---
if __name__ == "__main__":
    
    OUTPUT_FILE = OUTPUT_PB_FILE
    print(f"目标输出文件: {OUTPUT_FILE}")

    try:
        print("--- 阶段一：解析 YAML 源文件 ---")
        parsed_data = parse_all_yaml()
        
        print("\n--- 阶段二：构建 Protobuf 消息 ---")
        index_message = build_protobuf_index(parsed_data)
        
        print(f"Protobuf 协议版本: {index_message.protocol_version}")
        print(f"数据版本ID: {index_message.version_id}")

        print("\n--- 阶段三：序列化并写入磁盘 ---")
        # 序列化并写入二进制文件
        with open(OUTPUT_FILE, "wb") as f:
            # Protobuf 核心序列化方法
            f.write(index_message.SerializeToString()) 
        
        print(f"\n构建成功！二进制文件已保存到: {OUTPUT_FILE}")
        print(f"文件大小: {os.path.getsize(OUTPUT_FILE) / 1024:.2f} KB")

    except Exception as e:
        print(f"构建失败！致命错误: {e}", file=sys.stderr)
        sys.exit(1)