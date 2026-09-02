package service

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/example/studyflow/internal/domain"
	"github.com/example/studyflow/internal/platform"
)

func (s *Service) ListClassicalWorks(query, dynasty, genre string) []domain.ClassicalWork {
	query, dynasty, genre = strings.ToLower(strings.TrimSpace(query)), strings.TrimSpace(dynasty), strings.TrimSpace(genre)
	items := make([]domain.ClassicalWork, 0)
	for _, work := range classicalWorks() {
		haystack := strings.ToLower(work.Title + " " + work.Author + " " + work.Dynasty + " " + strings.Join(work.Tags, " ") + " " + strings.Join(work.Text, " "))
		if query != "" && !strings.Contains(haystack, query) {
			continue
		}
		if dynasty != "" && work.Dynasty != dynasty {
			continue
		}
		if genre != "" && work.Genre != genre {
			continue
		}
		items = append(items, work)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Featured != items[j].Featured {
			return items[i].Featured
		}
		return items[i].Title < items[j].Title
	})
	return items
}

func (s *Service) ClassicalWork(id string) (domain.ClassicalWork, error) {
	for _, work := range classicalWorks() {
		if work.ID == id {
			return work, nil
		}
	}
	return domain.ClassicalWork{}, domain.ErrNotFound
}
func (s *Service) ListClassicalStudies(ctx context.Context, userID string) ([]domain.ClassicalStudy, error) {
	return s.repo.ListClassicalStudies(ctx, userID)
}

type UpdateClassicalStudyInput struct {
	Favorite            *bool
	Status              *string
	Notes               *string
	IncrementRecitation bool
}

func (s *Service) UpdateClassicalStudy(ctx context.Context, userID, workID string, input UpdateClassicalStudyInput) (domain.ClassicalStudy, error) {
	if _, err := s.ClassicalWork(workID); err != nil {
		return domain.ClassicalStudy{}, err
	}
	study, err := s.repo.ClassicalStudyByWork(ctx, userID, workID)
	now := s.now().UTC()
	if err != nil && err != domain.ErrNotFound {
		return domain.ClassicalStudy{}, err
	}
	if err == domain.ErrNotFound {
		study = domain.ClassicalStudy{ID: platform.NewID(), UserID: userID, WorkID: workID, Status: "learning", CreatedAt: now}
	}
	if input.Favorite != nil {
		study.Favorite = *input.Favorite
	}
	if input.Status != nil {
		status := strings.TrimSpace(*input.Status)
		if status != "unread" && status != "learning" && status != "mastered" {
			return domain.ClassicalStudy{}, fmt.Errorf("%w: unsupported classical study status", domain.ErrInvalidInput)
		}
		study.Status = status
	}
	if input.Notes != nil {
		notes := strings.TrimSpace(*input.Notes)
		if utf8.RuneCountInString(notes) > 4000 {
			return domain.ClassicalStudy{}, fmt.Errorf("%w: classical notes exceed 4000 characters", domain.ErrInvalidInput)
		}
		study.Notes = notes
	}
	if input.IncrementRecitation {
		study.RecitationCount++
	}
	study.LastStudiedAt, study.UpdatedAt = now, now
	if err := s.repo.UpsertClassicalStudy(ctx, study); err != nil {
		return domain.ClassicalStudy{}, err
	}
	s.publish("classical.study.updated", userID, study.ID, map[string]any{"work_id": workID, "status": study.Status})
	return study, nil
}

func (s *Service) LiteratureOverview(ctx context.Context, userID string) (domain.LiteratureOverview, error) {
	books, err := s.repo.ListEBookReadings(ctx, userID)
	if err != nil {
		return domain.LiteratureOverview{}, err
	}
	studies, err := s.repo.ListClassicalStudies(ctx, userID)
	if err != nil {
		return domain.LiteratureOverview{}, err
	}
	overview := domain.LiteratureOverview{BooksInShelf: len(books), ClassicsStudied: len(studies)}
	for _, book := range books {
		if book.Status == "completed" {
			overview.BooksCompleted++
		}
		overview.ReadingMinutes += book.ReadingSeconds / 60
		overview.Bookmarks += len(book.Bookmarks)
	}
	for _, study := range studies {
		if study.Status == "mastered" {
			overview.ClassicsMastered++
		}
		if study.Favorite {
			overview.ClassicsFavorites++
		}
	}
	return overview, nil
}

func classicalWorks() []domain.ClassicalWork {
	return []domain.ClassicalWork{
		{ID: "tang-jing-ye-si", Title: "静夜思", Author: "李白", Dynasty: "唐", Genre: "诗", Difficulty: "入门", Text: []string{"床前明月光，疑是地上霜。", "举头望明月，低头思故乡。"}, Translation: []string{"明亮的月光洒在床前，我一时以为地面铺上了一层白霜。", "抬头望着天上的明月，低下头来思念遥远的故乡。"}, Annotations: []domain.ClassicalAnnotation{{Term: "疑", Meaning: "好像、仿佛。"}, {Term: "举头", Meaning: "抬头。"}}, Background: "羁旅中的诗人由月光触发乡思。全诗不写复杂故事，只抓住抬头与低头两个动作。", Appreciation: "语言近乎口语，却把月色、错觉与乡愁连成一个完整瞬间。最后的动作由外在观看转向内心思念，含蓄而有力量。", Tags: []string{"思乡", "月亮", "唐诗"}, Featured: true},
		{ID: "tang-deng-guan-que-lou", Title: "登鹳雀楼", Author: "王之涣", Dynasty: "唐", Genre: "诗", Difficulty: "入门", Text: []string{"白日依山尽，黄河入海流。", "欲穷千里目，更上一层楼。"}, Translation: []string{"夕阳依傍群山渐渐落下，黄河奔涌着向大海流去。", "想把更远的景色尽收眼底，就要再登上一层高楼。"}, Annotations: []domain.ClassicalAnnotation{{Term: "白日", Meaning: "太阳。"}, {Term: "穷", Meaning: "尽，使达到极点。"}, {Term: "千里目", Meaning: "远望的视野。"}}, Background: "鹳雀楼旧址在今山西永济。诗人从楼上远眺，将眼前景象提升为进取的思考。", Appreciation: "前两句写空间的辽阔，后两句把观景转为行动原则。“更上一层楼”因此成为不断拓展眼界的经典表达。", Tags: []string{"登高", "励志", "黄河"}, Featured: true},
		{ID: "tang-chun-wang", Title: "春望", Author: "杜甫", Dynasty: "唐", Genre: "诗", Difficulty: "进阶", Text: []string{"国破山河在，城春草木深。", "感时花溅泪，恨别鸟惊心。", "烽火连三月，家书抵万金。", "白头搔更短，浑欲不胜簪。"}, Translation: []string{"国都陷落，山河依旧；春天来到长安，草木却因无人照料而显得幽深。", "感伤时局，见花也像要落泪；怅恨离别，听到鸟鸣也感到惊心。", "战火延续了许多个月，一封家书珍贵得抵得上万两黄金。", "忧愁中抓挠白发，头发越来越稀少，几乎连簪子也插不住了。"}, Annotations: []domain.ClassicalAnnotation{{Term: "国破", Meaning: "国都长安被叛军占领。"}, {Term: "烽火", Meaning: "古代边防报警的烟火，此处指战争。"}, {Term: "浑欲", Meaning: "简直将要。"}, {Term: "不胜簪", Meaning: "稀疏得插不住簪子。"}}, Background: "唐肃宗至德二载，杜甫困居被叛军占领的长安，家人与自己分隔。", Appreciation: "宏大的战争从草木、花鸟、家书和白发进入个人经验。景物本无悲喜，却因诗人的处境而处处含情。", Tags: []string{"家国", "战争", "思亲"}, Featured: true},
		{ID: "tang-shan-ju-qiu-ming", Title: "山居秋暝", Author: "王维", Dynasty: "唐", Genre: "诗", Difficulty: "进阶", Text: []string{"空山新雨后，天气晚来秋。", "明月松间照，清泉石上流。", "竹喧归浣女，莲动下渔舟。", "随意春芳歇，王孙自可留。"}, Translation: []string{"空旷的山中刚下过一场雨，傍晚的天气显出清秋气息。", "明月从松林间照下，清澈的泉水从石头上流过。", "竹林的喧声传来，是洗衣女子归来；莲叶摇动，是渔舟顺流而下。", "任凭春天的花草凋谢，这样的秋山也足以让人留下。"}, Annotations: []domain.ClassicalAnnotation{{Term: "暝", Meaning: "日落，天色将晚。"}, {Term: "浣女", Meaning: "洗衣的女子。"}, {Term: "春芳歇", Meaning: "春天的花草已经凋谢。"}, {Term: "王孙", Meaning: "原指贵族子弟，此处也可理解为诗人自指。"}}, Background: "王维隐居辋川时期的山水名篇，描写雨后秋山的傍晚。", Appreciation: "诗中先静后动，月光与清泉构成清澈底色，人的归来又为山林增添生活气息。", Tags: []string{"山水", "秋天", "隐居"}},
		{ID: "song-shui-diao-ge-tou", Title: "水调歌头·明月几时有", Author: "苏轼", Dynasty: "宋", Genre: "词", Difficulty: "进阶", Text: []string{"明月几时有？把酒问青天。不知天上宫阙，今夕是何年。我欲乘风归去，又恐琼楼玉宇，高处不胜寒。起舞弄清影，何似在人间。", "转朱阁，低绮户，照无眠。不应有恨，何事长向别时圆？人有悲欢离合，月有阴晴圆缺，此事古难全。但愿人长久，千里共婵娟。"}, Translation: []string{"明月从什么时候开始出现？我端起酒杯询问天空。不知道天上的宫殿，今晚是哪一年。我想乘风回到天上，又担心美玉砌成的楼宇太高，承受不了寒冷。索性在人间对着月影起舞，这又何尝不好。", "月光转过朱红楼阁，低低照进雕花窗户，照着无法入睡的人。月亮本不该有怨恨，为什么偏偏在人们离别时变圆？人生有悲欢离合，月亮有阴晴圆缺，这些事自古难以周全。只愿亲人平安长久，即使相隔千里也能共享这轮明月。"}, Annotations: []domain.ClassicalAnnotation{{Term: "宫阙", Meaning: "宫殿。"}, {Term: "不胜寒", Meaning: "承受不了寒冷。"}, {Term: "绮户", Meaning: "雕花的窗户。"}, {Term: "婵娟", Meaning: "此处指明月。"}}, Background: "宋神宗熙宁九年中秋，苏轼在密州饮酒赏月，思念多年未见的弟弟苏辙。", Appreciation: "词从向天发问开始，在出世与入世之间徘徊，最终承认人生的不圆满，并把个人离愁转化为普遍祝愿。", Tags: []string{"中秋", "思亲", "月亮"}, Featured: true},
		{ID: "song-ding-feng-bo", Title: "定风波·莫听穿林打叶声", Author: "苏轼", Dynasty: "宋", Genre: "词", Difficulty: "进阶", Text: []string{"莫听穿林打叶声，何妨吟啸且徐行。竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。", "料峭春风吹酒醒，微冷，山头斜照却相迎。回首向来萧瑟处，归去，也无风雨也无晴。"}, Translation: []string{"不必在意雨点穿过树林敲打树叶的声音，不妨一边吟咏长啸，一边从容前行。拄竹杖、穿草鞋比骑马还轻快，有什么可怕？披一件蓑衣，任凭一生经历烟雨。", "带着寒意的春风把酒意吹醒，略感微冷；山头的夕阳却前来相迎。回头看看刚才风雨萧瑟的地方，回去吧，对我而言已无所谓风雨或晴天。"}, Annotations: []domain.ClassicalAnnotation{{Term: "吟啸", Meaning: "吟诗长啸。"}, {Term: "芒鞋", Meaning: "草鞋。"}, {Term: "料峭", Meaning: "形容春寒。"}, {Term: "向来", Meaning: "方才、刚才。"}}, Background: "苏轼被贬黄州时途中遇雨，同行者狼狈，只有他从容行走。", Appreciation: "眼前风雨既是自然天气，也是人生处境。结尾并非否认困难，而是表达不再被外界晴雨支配的内心自由。", Tags: []string{"旷达", "风雨", "人生"}},
		{ID: "tang-lou-shi-ming", Title: "陋室铭", Author: "刘禹锡", Dynasty: "唐", Genre: "古文", Difficulty: "入门", Text: []string{"山不在高，有仙则名。水不在深，有龙则灵。斯是陋室，惟吾德馨。", "苔痕上阶绿，草色入帘青。谈笑有鸿儒，往来无白丁。可以调素琴，阅金经。无丝竹之乱耳，无案牍之劳形。", "南阳诸葛庐，西蜀子云亭。孔子云：何陋之有？"}, Translation: []string{"山不一定要高，有仙人居住就会出名；水不一定要深，有龙潜藏就显得灵异。这虽是一间简陋屋子，只因居住者品德好便不觉简陋。", "碧绿苔痕爬上台阶，青草的颜色映入帘中。来往谈笑的是博学的人，没有缺少学问的俗客。可以弹奏朴素的琴，阅读佛经；没有嘈杂音乐扰乱听觉，也没有官府公文使身体劳累。", "它可以比作诸葛亮的草庐和扬雄的亭子。孔子说：有什么简陋的呢？"}, Annotations: []domain.ClassicalAnnotation{{Term: "德馨", Meaning: "品德美好。馨，能远播的香气。"}, {Term: "鸿儒", Meaning: "博学的读书人。"}, {Term: "白丁", Meaning: "平民，此处指没有功名、学问浅的人。"}, {Term: "案牍", Meaning: "官府公文。"}}, Background: "“铭”是刻在器物上用来警戒自己或称述功德的文字。本文借陋室表达安贫乐道的志趣。", Appreciation: "文章大量使用对偶，节奏简洁。物质空间虽小，精神生活却因德行、友情和阅读而丰足。", Tags: []string{"品德", "安贫乐道", "古文"}},
		{ID: "song-ai-lian-shuo", Title: "爱莲说", Author: "周敦颐", Dynasty: "宋", Genre: "古文", Difficulty: "进阶", Text: []string{"水陆草木之花，可爱者甚蕃。晋陶渊明独爱菊。自李唐来，世人甚爱牡丹。予独爱莲之出淤泥而不染，濯清涟而不妖，中通外直，不蔓不枝，香远益清，亭亭净植，可远观而不可亵玩焉。", "予谓菊，花之隐逸者也；牡丹，花之富贵者也；莲，花之君子者也。噫！菊之爱，陶后鲜有闻。莲之爱，同予者何人？牡丹之爱，宜乎众矣。"}, Translation: []string{"水上和陆地各种草木的花，值得喜爱的很多。晋代陶渊明只爱菊花；从唐代以来，世人非常喜爱牡丹。我唯独喜爱莲花从淤泥中长出却不受污染，经过清水洗涤却不显得妖媚；茎内贯通、外形挺直，不横生藤蔓，也不旁出枝节；香气传得越远越清幽，洁净挺立，只适合远远观赏而不可轻慢玩弄。", "我认为菊花是花中的隐士，牡丹是花中的富贵者，莲花是花中的君子。唉！喜爱菊花的人，陶渊明之后很少听说；像我一样喜爱莲花的，还有谁呢？喜爱牡丹的人当然很多了。"}, Annotations: []domain.ClassicalAnnotation{{Term: "蕃", Meaning: "多。"}, {Term: "濯", Meaning: "洗涤。"}, {Term: "亵玩", Meaning: "亲近而不庄重地玩弄。"}, {Term: "鲜", Meaning: "少。"}}, Background: "“说”是古代议论性文体。作者借不同花卉象征不同人格取向。", Appreciation: "莲的自然特征被转化为君子人格：处境复杂而保持清白，内心通达而行为正直。托物言志使抽象品格变得具体可感。", Tags: []string{"君子", "托物言志", "莲花"}},
		{ID: "jin-lan-ting-ji", Title: "兰亭集序", Author: "王羲之", Dynasty: "晋", Genre: "古文", Difficulty: "挑战", Text: []string{"永和九年，岁在癸丑，暮春之初，会于会稽山阴之兰亭，修禊事也。群贤毕至，少长咸集。此地有崇山峻岭，茂林修竹；又有清流激湍，映带左右，引以为流觞曲水，列坐其次。虽无丝竹管弦之盛，一觞一咏，亦足以畅叙幽情。", "是日也，天朗气清，惠风和畅。仰观宇宙之大，俯察品类之盛，所以游目骋怀，足以极视听之娱，信可乐也。", "夫人之相与，俯仰一世，或取诸怀抱，悟言一室之内；或因寄所托，放浪形骸之外。虽趣舍万殊，静躁不同，当其欣于所遇，暂得于己，快然自足，不知老之将至。", "向之所欣，俯仰之间，已为陈迹，犹不能不以之兴怀。况修短随化，终期于尽！古人云：死生亦大矣。岂不痛哉！"}, Translation: []string{"永和九年癸丑年，暮春之初，我们在会稽山阴的兰亭聚会，举行修禊活动。贤士们全都到来，年长年少者齐聚。这里有高山峻岭、茂密树林和修长竹子，又有清澈急流环绕左右。我们把水引作曲水流觞，依次坐在水边。虽然没有盛大的乐队，饮一杯酒、作一首诗，也足以畅快表达幽深情怀。", "这一天晴朗清明，和风舒畅。抬头观看广大的宇宙，低头观察繁盛的万物，借此纵目舒展胸怀，足以尽享视听的乐趣，确实令人快乐。", "人与人相处，很快便度过一生。有的人在室内面对面畅谈胸怀，有的人把情感寄托于喜爱的事物，在形体之外自由放浪。取舍千差万别，性情或安静或活跃；当他们为眼前际遇欣喜、暂时感到自得时，便快乐满足，甚至忘记衰老即将到来。", "过去所喜爱的事物，转眼已经成为旧迹，仍不免由此触发感慨。何况寿命长短都随自然变化，最终总会结束。古人说，生死是大事，怎能不令人悲痛！"}, Annotations: []domain.ClassicalAnnotation{{Term: "修禊", Meaning: "古代在水边举行的祓除不祥的活动。"}, {Term: "流觞曲水", Meaning: "把酒杯放在弯曲水流中，停在谁面前谁便饮酒赋诗。"}, {Term: "品类", Meaning: "自然界万物。"}, {Term: "趣舍", Meaning: "取舍、爱好。"}}, Background: "东晋永和九年，王羲之与友人在兰亭修禊、饮酒赋诗，本文是诗集序言。", Appreciation: "文章从良辰美景和聚会之乐转向时间流逝与生死之痛。情绪的转折让欢乐更显短暂，也使个体感受获得跨越时代的共鸣。", Tags: []string{"生命", "雅集", "书法"}},
		{ID: "preqin-quan-xue", Title: "劝学（节选）", Author: "荀子", Dynasty: "先秦", Genre: "古文", Difficulty: "挑战", Text: []string{"君子曰：学不可以已。青，取之于蓝，而青于蓝；冰，水为之，而寒于水。木直中绳，𫐓以为轮，其曲中规。虽有槁暴，不复挺者，𫐓使之然也。", "吾尝终日而思矣，不如须臾之所学也；吾尝跂而望矣，不如登高之博见也。登高而招，臂非加长也，而见者远；顺风而呼，声非加疾也，而闻者彰。", "积土成山，风雨兴焉；积水成渊，蛟龙生焉；积善成德，而神明自得，圣心备焉。故不积跬步，无以至千里；不积小流，无以成江海。"}, Translation: []string{"君子说：学习不可以停止。靛青从蓝草中提取，却比蓝草更青；冰由水凝成，却比水更冷。木材本来笔直合乎墨线，经过火烤弯曲做成车轮，弧度便符合圆规。即使后来晒干，也不再挺直，是加工使它变成这样。", "我曾经整天思考，却不如片刻学习所得多；我曾踮起脚远望，却不如登到高处看得广。登高招手，手臂没有变长，远处的人却能看见；顺风呼喊，声音没有增强，听的人却听得清楚。", "堆积泥土成为高山，风雨便在那里兴起；汇积水流成为深潭，蛟龙便在那里生长；积累善行养成品德，智慧自然获得，圣人的思想也就具备。因此不积累半步一步，就无法到达千里；不汇聚细小水流，就无法形成江海。"}, Annotations: []domain.ClassicalAnnotation{{Term: "已", Meaning: "停止。"}, {Term: "中绳", Meaning: "合乎木工使用的墨线。"}, {Term: "须臾", Meaning: "片刻。"}, {Term: "跬步", Meaning: "古代称跨出一脚为跬，两脚为步。"}}, Background: "《劝学》系统论述学习的意义、方法和态度，善用生活中的比喻说明抽象道理。", Appreciation: "文章不把学习理解为天赋，而强调环境、工具和持续积累。比喻层层推进，使“改变自己”与“长期积累”成为可执行的方法。", Tags: []string{"学习", "积累", "先秦"}, Featured: true},
		{ID: "preqin-lun-yu-xue-er", Title: "《论语》学习章句", Author: "孔子及其弟子", Dynasty: "先秦", Genre: "语录", Difficulty: "入门", Text: []string{"学而时习之，不亦说乎？有朋自远方来，不亦乐乎？人不知而不愠，不亦君子乎？", "知之者不如好之者，好之者不如乐之者。", "三人行，必有我师焉。择其善者而从之，其不善者而改之。", "温故而知新，可以为师矣。"}, Translation: []string{"学习之后按时复习实践，不也是令人愉快的吗？朋友从远方来，不也是快乐的吗？别人不了解自己却不怨恨，不也是君子的修养吗？", "仅仅知道某件事的人，不如真正喜爱它的人；喜爱它的人，又不如能从中获得快乐的人。", "几个人同行，其中一定有人可以做我的老师。选择他的优点学习，看到他的缺点便反省并改正自己。", "温习旧知识并从中获得新的理解，就可以做老师了。"}, Annotations: []domain.ClassicalAnnotation{{Term: "说", Meaning: "同“悦”，愉快。"}, {Term: "愠", Meaning: "生气、怨恨。"}, {Term: "好", Meaning: "喜爱。"}, {Term: "温故", Meaning: "温习旧知识。"}}, Background: "《论语》由孔子弟子及再传弟子编纂，记录孔子及其弟子的言行。这里选取与学习方法相关的章句。", Appreciation: "这些章句把学习看成复习、兴趣、观察他人和形成新理解的循环，而非一次性的知识接收。", Tags: []string{"学习方法", "君子", "语录"}},
	}
}
