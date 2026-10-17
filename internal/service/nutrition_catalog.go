package service

import (
	"strings"

	"github.com/example/studyflow/internal/domain"
)

// These original Chinese meal combinations illustrate food groups, not measured
// macros or guaranteed restaurant ingredients. Listed allergens are conservative
// hints, including common seasonings; an absent tag never guarantees safety.
func NutritionCatalog() []domain.NutritionCard {
	card := func(id, title, slots, channels, goals string, plant bool, allergens, staple, protein, produce, reason, tip string) domain.NutritionCard {
		return domain.NutritionCard{ID: id, Title: title, Slots: strings.Fields(slots), Channels: strings.Fields(channels), Goals: strings.Fields(goals), PlantOnly: plant, Allergens: append([]string{}, strings.Fields(allergens)...), Parts: []domain.NutritionPart{{Role: "staple", Text: staple}, {Role: "protein", Text: protein}, {Role: "produce", Text: produce}}, Reason: reason, Tip: tip}
	}
	return []domain.NutritionCard{
		card("oat-milk", "燕麦牛奶与鸡蛋早餐", "breakfast", "home convenience", "balanced training", false, "milk egg wheat", "原味燕麦", "纯牛奶、熟鸡蛋", "一份完整水果", "把主食、蛋奶和水果放在同一餐，适合不想复杂准备的早晨。", "选无额外加糖的燕麦；燕麦可能与小麦混杂，按包装核实。"),
		card("soy-corn", "豆浆玉米早餐", "breakfast", "canteen convenience home", "balanced lighter training", true, "soy", "玉米或蒸红薯", "无糖豆浆、原味熟毛豆", "小番茄或一份水果", "植物性搭配也保留豆类和主食，不只喝一杯饮料。", "豆浆和熟毛豆按实际食量组合；包装食品看配料、糖和钠。"),
		card("egg-toast", "全麦鸡蛋三明治组合", "breakfast", "delivery convenience home", "balanced training", false, "wheat egg milk soy sesame", "全麦面包", "全熟鸡蛋", "生菜、番茄及一份水果", "适合赶时间时带走，保留看得见的蛋白质食物和蔬果。", "酱料少放或分装；成品面包可能含奶、大豆或芝麻，先看标签。"),
		card("millet-tofu", "小米粥与豆腐早餐", "breakfast", "canteen home", "balanced lighter", true, "soy", "小米粥、蒸南瓜", "原味豆腐", "一碟熟青菜", "用豆腐和青菜补上只喝粥时容易遗漏的食物类别。", "选择清淡熟制豆腐，少配咸菜；南瓜计入主食搭配而非替代全部蔬菜。"),
		card("yogurt-oats", "原味酸奶燕麦碗", "breakfast", "convenience home", "balanced training", false, "milk wheat", "原味燕麦", "无额外加糖的原味酸奶", "香蕉或其他完整水果", "买齐后即可组合，适合不想开火的早晨。", "查看燕麦与酸奶标签；风味酸奶和脆麦片的添加糖可能不同。"),
		card("egg-noodle", "青菜鸡蛋汤面", "breakfast lunch dinner", "canteen delivery home", "balanced training", false, "wheat egg soy sesame", "普通面条或全麦面", "全熟鸡蛋", "足量青菜、菌菇", "普通汤面也可以搭得完整，不必只选择标注健身的食品。", "备注少油少盐、加青菜；汤与调料分开，不必喝完汤。"),
		card("rice-chicken", "鸡肉双蔬米饭便当", "lunch dinner", "canteen delivery home", "balanced training lighter", false, "soy wheat sesame", "米饭，可与杂粮搭配", "非油炸鸡肉", "两种熟蔬菜", "有主食、有肉、有蔬菜，方便在食堂或外卖里找到。", "搜索鸡肉便当，备注非油炸、酱汁分装、加蔬菜；按饥饿感选饭量，不要求不吃饭。"),
		card("fish-rice", "清蒸鱼与时蔬饭", "lunch dinner", "canteen delivery home", "balanced lighter training", false, "fish soy wheat", "米饭或杂粮饭", "熟透的清蒸鱼", "绿叶菜、胡萝卜等时蔬", "用清蒸鱼和熟蔬菜组成容易辨认食材的一餐。", "清蒸不一定低盐，蒸鱼汁可分开；鱼刺与实际配料需自行确认。"),
		card("beef-potato", "番茄牛肉土豆饭", "lunch dinner", "canteen delivery home", "balanced training", false, "soy wheat", "米饭与土豆按食量搭配", "熟牛肉", "番茄、另配一份绿叶菜", "牛肉炖菜也可以配成一餐，不把土豆误当作全部蔬菜。", "选择非油炸、肥肉较少的做法；炖汁少拌饭，土豆和米饭一起考虑主食量。"),
		card("shrimp-rice", "虾仁蔬菜米饭", "lunch dinner", "canteen delivery home", "balanced lighter training", false, "shellfish soy wheat sesame", "米饭或杂粮饭", "熟虾仁", "西兰花、菌菇及其他时蔬", "适合喜欢海鲜的人，搭配主食而不是只吃一盒菜。", "先确认虾及蚝油等调味成分；备注少油、酱汁分装。"),
		card("tofu-rice", "豆腐双蔬杂粮饭", "lunch dinner", "canteen delivery home", "balanced lighter training", true, "soy wheat sesame", "杂粮饭或米饭", "非油炸豆腐、熟毛豆", "两种熟蔬菜", "不吃肉时用豆腐和豆类参与搭配，仍保留主食。", "选择不含肉末、蚝油或荤汤的版本；是否植物性须向商家核实。"),
		card("chickpea-bowl", "鹰嘴豆时蔬饭碗", "lunch dinner", "delivery home", "balanced training lighter", true, "soy wheat sesame", "糙米饭或普通米饭", "充分煮熟的鹰嘴豆", "南瓜以外的多种时蔬", "豆类、谷物和蔬菜组合，提供与肉类便当不同的选择。", "购买熟制豆类；罐装先看钠含量。成品酱汁可能含大豆、小麦或芝麻。"),
		card("egg-tofu-rice", "鸡蛋豆腐双拼饭", "lunch dinner", "canteen home", "balanced training", false, "egg soy wheat", "米饭", "全熟鸡蛋、豆腐", "绿叶菜与菌菇", "食堂常见的蛋豆双拼，容易按实际饭量组合。", "豆腐尽量选非油炸，少放浓汁；不因有两种蛋白质食物而刻意无限加量。"),
		card("beef-noodle", "牛肉青菜汤面", "lunch dinner", "canteen delivery home", "balanced training", false, "wheat soy sesame", "面条", "熟牛肉", "加一份青菜", "面食也能作为正常主食，关键是把配菜配齐。", "确认有实际肉类配料；少油少盐、汤分开，不把一碗汤当作一份肉。"),
		card("chicken-salad", "有主食的鸡肉沙拉", "lunch dinner", "delivery convenience home", "balanced lighter", false, "soy wheat egg milk sesame", "玉米、土豆或全麦面包", "非油炸熟鸡肉", "多种新鲜蔬菜", "给沙拉保留主食，不用只吃生菜来替代正餐。", "酱汁分装，按饥饿感选择份量；注意冷链，沙拉酱常含蛋、奶或芝麻。"),
		card("warm-pot", "清汤自选蔬菜豆腐锅", "lunch dinner", "canteen delivery home", "balanced lighter", true, "soy wheat sesame", "米饭或面条", "非油炸豆腐、熟豆类", "多种熟蔬菜", "可以在自选餐中按类别组合，不只点蔬菜或加工丸子。", "选择植物性清汤并确认配料；少蘸料、不要求喝汤。清汤也可能高盐。"),
		card("convenience-egg", "便利店鸡蛋饭团组合", "lunch dinner", "convenience", "balanced training", false, "egg soy wheat fish sesame", "饭团", "原味熟鸡蛋", "即食蔬菜、完整水果", "在便利店补齐一顿饭，而不是只买一个饭团。", "饭团常含鱼、酱油或芝麻；检查馅料及标签，冷藏即食食品按要求保存。"),
		card("convenience-tofu", "便利店豆腐玉米组合", "lunch dinner", "convenience home", "balanced lighter training", true, "soy", "玉米或蒸红薯", "原味即食豆腐、熟毛豆", "即食蔬菜或小番茄", "不用开火也可组合主食、豆制品和蔬菜。", "选择明确植物性且配料简单的产品，按标签保存，不默认调味豆干等同原味豆腐。"),
		card("home-pork", "瘦肉菌菇家常饭", "lunch dinner", "home canteen", "balanced training", false, "soy wheat", "米饭与杂粮搭配", "熟瘦猪肉", "菌菇、绿叶菜", "不局限鸡胸肉，家常餐也可以保持食物多样。", "选择瘦肉、非油炸做法，少用浓稠酱汁；份量按自身需要调整。"),
		card("home-lentil", "扁豆蔬菜饭", "lunch dinner", "home", "balanced training lighter", true, "", "米饭", "充分煮熟的食用扁豆或小扁豆", "胡萝卜、番茄与绿叶菜", "给植物性正餐一个不依赖豆腐的选项。", "豆类必须充分煮熟，按产品说明处理；本组合不列调味料，另行确认油盐及过敏风险。"),
		card("fruit-yogurt", "水果配原味酸奶", "snack", "delivery convenience home", "balanced training", false, "milk wheat", "根据饥饿感搭配少量原味燕麦", "原味酸奶", "一份完整水果", "需要加餐时选择普通食物，不必依赖特殊健身零食。", "加餐按需要，不强制每天吃；选无额外加糖酸奶，燕麦另查小麦交叉接触提示。"),
		card("banana-soy", "香蕉配无糖豆浆", "snack", "canteen delivery convenience home", "balanced training lighter", true, "soy", "香蕉也提供碳水化合物", "无糖豆浆", "香蕉或其他完整水果", "想吃一点时，方便带走的水果与豆类饮品组合。", "只是可选加餐，不设所谓训练后黄金窗口；根据饥饿感及下一餐时间决定。"),
		card("egg-fruit", "熟鸡蛋与水果", "snack", "canteen convenience home", "balanced lighter training", false, "egg", "如仍饥饿可搭配玉米", "原味熟鸡蛋", "一份完整水果", "简单的日常加餐，不用额外购买营养补剂。", "鸡蛋完全熟制并妥善保存；不是额外强制任务，也不能替代长期完整正餐。"),
		card("edamame-fruit", "原味毛豆与水果", "snack", "convenience home", "balanced lighter training", true, "soy", "按需要搭配玉米", "原味熟毛豆", "一份完整水果", "提供植物性加餐思路，避免只有甜饮料的选择。", "毛豆必须熟制，优先少盐版本；结合正餐而非额外无限量叠加。"),
	}
}
