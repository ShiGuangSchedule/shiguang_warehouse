// shiguang-bridge.d.ts
// 适配脚本全局类型声明，供 VSCode / JetBrains 识别 window.shiguangBridgePromise 与 window.shiguangBridge
// 本文档不参与运行时，不会被浏览器加载

/**
 * 异步交互 API，挂载于 window.shiguangBridgePromise。
 * 所有方法均返回 Promise，需配合 await 使用。
 */
interface ShiguangBridgePromise {
    /**
     * 显示公告弹窗，等待用户确认。
     *
     * @param title 弹窗标题
     * @param content 弹窗内容
     * @param confirmText 确认按钮文本
     * @returns 确认返回 true，取消返回 false
     */
    showAlert(title: string, content: string, confirmText: string): Promise<boolean>;

    /**
     * 显示输入框弹窗，支持 JS 侧校验。
     *
     * @param title 弹窗标题
     * @param tip 输入框提示文本
     * @param defaultText 默认文本
     * @param validatorJsFunction 全局作用域中的验证函数名。
     *        返回 false 表示通过，返回字符串表示错误信息。
     * @returns 用户输入内容；取消返回 null
     */
    showPrompt(
        title: string,
        tip: string,
        defaultText: string,
        validatorJsFunction?: string
    ): Promise<string | null>;

    /**
     * 显示单选列表弹窗。
     *
     * @param title 弹窗标题
     * @param itemsJsonString 选项列表的 JSON 字符串，如 '["选项1","选项2"]'
     * @param defaultSelectedIndex 默认选中索引，-1 表示不选中
     * @returns 选中索引；取消返回 null
     */
    showSingleSelection(
        title: string,
        itemsJsonString: string,
        defaultSelectedIndex?: number
    ): Promise<number | null>;

    /**
     * 提交课程数据。
     *
     * 传入的 JSON 字符串每项字段：
     * - `name` 课程名
     * - `teacher` 老师
     * - `position` 地点
     * - `day` 星期 1~7
     * - `startSection` / `endSection` 起止节次，isCustomTime 为 false 时必填
     * - `weeks` 周次数组
     * - `isCustomTime` 是否自定义时间，默认 false
     * - `customStartTime` / `customEndTime` 自定义时间 HH:mm，isCustomTime 为 true 时必填
     * - `credit` 学分
     *
     * @param coursesJsonString 课程数组的 JSON 字符串
     * @returns 导入成功返回 true，失败抛出 Error
     */
    saveImportedCourses(coursesJsonString: string): Promise<true>;

    /**
     * 提交预设时间段数据。
     *
     * 传入的 JSON 字符串每项字段：
     * - `number` 节次编号，必须从 1 开始连续递增
     * - `startTime` / `endTime` 起止时间 HH:mm
     *
     * 时间段之间不允许重叠。
     *
     * 若本次导入包含组合作息方案，本方法必须先于 saveComboSchedule 调用且成功。
     *
     * @param timeSlotsJsonString 时间段数组的 JSON 字符串
     * @returns 导入成功返回 true，失败抛出 Error
     */
    savePresetTimeSlots(timeSlotsJsonString: string): Promise<true>;

    /**
     * 提交课表配置数据。
     *
     * 传入的 JSON 字符串字段：
     * - `semesterStartDate` 学期开始日期 YYYY-MM-DD，默认 null
     * - `semesterTotalWeeks` 总周数，默认 20
     * - `defaultClassDuration` 单节时长（分钟），默认 45
     * - `defaultBreakDuration` 课间休息（分钟），默认 10
     * - `firstDayOfWeek` 一周第一天，1=周一，7=周日，默认 1
     *
     * 只需提供想修改的字段。
     *
     * @param configJsonString 课表配置的 JSON 字符串
     * @returns 导入成功返回 true，失败抛出 Error
     */
    saveCourseConfig(configJsonString: string): Promise<true>;

    /**
     * 提交组合作息方案。
     *
     * 传入的 JSON 字符串字段：
     * - `name` 方案名，可选，为空时回退为当前课表名
     * - `publicSchedules` 公共作息模板数组
     *
     * 每个模板字段：
     * - `name` 作息名
     * - `startDate` / `endDate` 生效区间 YYYY-MM-DD
     * - `defaultClassDuration` / `defaultBreakDuration` 时长（分钟），默认 45 / 10
     * - `timeSlots` 节次时间点数组，可只提交差异节次，未提供的由基础时间段补齐
     *
     * 必须先成功调用 savePresetTimeSlots，否则会被直接拒绝。
     *
     * @param comboScheduleJsonString 组合作息方案的 JSON 字符串
     * @returns 导入成功返回 true，失败抛出 Error
     */
    saveComboSchedule(comboScheduleJsonString: string): Promise<true>;
}

/**
 * 同步辅助 API，挂载于 window.shiguangBridge。
 * 不阻塞 JS 流程，主要用于即时反馈或生命周期通知。
 */
interface ShiguangBridge {
    /**
     * 在界面短暂显示一条提示信息。
     *
     * @param message 提示内容
     */
    showToast(message: string): void;

    /**
     * 通知任务完成，执行收尾。
     * 仅应在整个流程成功完成后调用。
     */
    notifyTaskCompletion(): void;
}

declare global {
    interface Window {
        /** 异步交互 API */
        shiguangBridgePromise: ShiguangBridgePromise;
        /** 同步辅助 API */
        shiguangBridge: ShiguangBridge;

        /** @deprecated 旧版兼容别名，请使用 shiguangBridgePromise */
        AndroidBridgePromise: ShiguangBridgePromise;
        /** @deprecated 旧版兼容别名，请使用 shiguangBridge */
        AndroidBridge: ShiguangBridge;
    }
}

export {};