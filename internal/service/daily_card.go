package service

import (
	"context"
	"crypto/rand"
	"fmt"
	"github.com/example/studyflow/internal/domain"
	"math/big"
	"time"
	"unicode/utf8"
)

// Original, versioned editorial collection. Keep ordering stable for historical dates.
var dailyCardTexts = [][4]string{
	{"留白", "不是每一寸时间，都需要被填满。", "给自己留五分钟，不安排任何任务。", "今天，什么事情可以暂时放下？"},
	{"看见", "熟悉的风景，也值得再看一眼。", "找出身边一个之前忽略的小细节。", "是什么让平常的一天变得特别？"},
	{"慢行", "慢一点，不等于没有向前。", "把一件日常小事做得比平时从容些。", "什么节奏更适合现在的我？"},
	{"表达", "心意不必宏大，具体就足够动人。", "写下一句具体的感谢，可以不发送。", "我想感谢谁，为什么？"},
	{"开始", "一个小小的开始，也有自己的重量。", "用两分钟开始一件一直想做的小事。", "我迟迟未开始，是在等待什么？"},
	{"倾听", "有时，不急着回应就是一种陪伴。", "听完一首歌，或认真听完一段分享。", "今天我真正听见了什么？"},
	{"轻装", "放下一点，才能感到手里还有什么。", "整理桌面上的三件物品。", "哪些东西对我仍然重要？"},
	{"好奇", "不懂的地方，也可以是新路的入口。", "为今天遇到的一件事问一个为什么。", "最近有什么让我产生好奇？"},
	{"身体", "身体不是进度条，它也需要被照顾。", "在舒适范围内换个姿势，休息片刻。", "此刻的身体需要什么？"},
	{"记忆", "普通的片刻，后来也会成为想念。", "记下一件今天很普通的小事。", "我希望以后还记得今天的什么？"},
	{"边界", "照顾别人时，也给自己留一个位置。", "为一件不紧急的事留出回应的时间。", "哪条边界能让我更自在？"},
	{"尝鲜", "新鲜感，有时只隔着一个小选择。", "换一首歌，或换一种熟悉的做事顺序。", "今天我愿意尝试哪一点不同？"},
	{"安顿", "不必立刻解决一切，先让自己坐稳。", "整理一个能让自己舒服坐下的角落。", "什么能让我有一点安定感？"},
	{"关系", "一段关系，常由许多小小的在意组成。", "想起一个人，写下一段共同的回忆。", "我珍惜这段关系的什么？"},
	{"勇气", "承认不确定，也是一种诚实的勇气。", "写下一个还没有答案的问题。", "我可以带着哪个疑问继续生活？"},
	{"欣赏", "美不一定远，有时就在手边。", "观察一件物品的颜色、形状和质地。", "今天有什么让我愿意多看一眼？"},
	{"宽容", "一次不顺利，不能概括整个自己。", "把一句自责改写为一句具体的描述。", "如果是朋友遇到这件事，我会怎么说？"},
	{"选择", "适合自己的答案，不一定最热闹。", "写下一个自己喜欢但不需要解释的选择。", "哪些喜欢，是我真正自己的？"},
	{"停靠", "休息不是退出，而是为自己留一处停靠。", "暂时离开屏幕，看看远处的景物。", "今天哪里可以容纳一小段休息？"},
	{"生活", "生活的滋味，藏在认真感受的瞬间。", "慢慢品尝一口日常的食物或饮品。", "今天我感受到哪些具体的味道？"},
	{"松弛", "允许事情普通，也允许自己轻松一点。", "做一件不用展示成果的小事。", "如果不用证明什么，我想怎么过今天？"},
	{"整理", "理清一小处，也能让心里亮一点。", "给一个常用文件或物品找个固定位置。", "什么小改变能让明天方便一些？"},
	{"期待", "期待可以很小，小到明天的一杯热茶。", "为明天安排一件简单、可实现的乐事。", "最近有什么值得我期待？"},
	{"真实", "不必把每一种感受都修饰得漂亮。", "用三个词描述现在的心情。", "哪些感受，我愿意先承认它的存在？"},
	{"陪伴", "独处时，也可以好好陪着自己。", "用自己喜欢的方式度过五分钟。", "和自己相处时，我喜欢什么？"},
	{"回望", "有些变化，走远一点才看得见。", "写下一件现在比过去更熟练的小事。", "我在哪些地方悄悄发生了改变？"},
	{"创造", "没有标准答案的事，也值得动手试试。", "画一个随意的图形，为它起个名字。", "最近我想创造什么，而不只是消费什么？"},
	{"余地", "计划之外，也可能有值得留下的风景。", "给今天的安排留一点弹性。", "如果计划改变，我还可以怎样选择？"},
	{"珍惜", "拥有的东西，也值得被重新发现。", "想一件已经拥有、仍然喜欢的东西。", "什么一直在支持我的生活？"},
	{"善意", "一份小小的善意，不需要成为大事。", "做一件不打扰别人、力所能及的小事。", "什么样的善意让我感到舒服？"},
	{"收尾", "今天不必完美，也可以温柔地结束。", "写下一件已经做到的事，无论大小。", "今天有什么，我愿意对自己说声谢谢？"},
}

func (s *Service) dailyBase(user, date string) (domain.Exploration, error) {
	zone, _ := time.LoadLocation("Asia/Shanghai")
	now := s.now()
	if date == "" {
		date = now.In(zone).Format("2006-01-02")
	}
	d, err := time.Parse("2006-01-02", date)
	if err != nil || d.Format("2006-01-02") != date || date < "2026-01-01" || date > now.In(zone).Format("2006-01-02") {
		return domain.Exploration{}, fmt.Errorf("%w: 日签日期须在 2026-01-01 至今天之间", domain.ErrInvalidInput)
	}
	return domain.Exploration{ID: user + ":daily:" + date, UserID: user, Kind: "daily", Date: date, CreatedAt: now.UTC()}, nil
}

// The atomic store operation returns the first draw even for concurrent requests.
func (s *Service) DrawDailyCard(ctx context.Context, user string) (domain.Exploration, error) {
	card, err := s.DailyCard(ctx, user, "")
	if err != nil || card.Body != "" {
		return card, err
	}
	n, err := rand.Int(rand.Reader, big.NewInt(int64(len(dailyCardTexts))))
	if err != nil {
		return card, err
	}
	v := dailyCardTexts[n.Int64()]
	card.Title, card.Body, card.Action, card.Prompt = v[0], v[1], v[2], v[3]
	card.SignNumber = int(n.Int64()) + 1
	return s.repo.SaveDailyCard(ctx, card, nil, nil)
}
func (s *Service) DailyCard(ctx context.Context, user, date string) (domain.Exploration, error) {
	card, err := s.dailyBase(user, date)
	if err != nil {
		return card, err
	}
	items, err := s.repo.ListExplorations(ctx, user)
	if err != nil {
		return card, err
	}
	for _, v := range items {
		if v.ID == card.ID && v.Kind == "daily" {
			return v, nil
		}
	}
	return card, nil
}
func (s *Service) SaveDailyCard(ctx context.Context, user, date string, favorite *bool, reflection *string) (domain.Exploration, error) {
	if favorite == nil && reflection == nil {
		return domain.Exploration{}, domain.ErrInvalidInput
	}
	if reflection != nil && utf8.RuneCountInString(*reflection) > 3000 {
		return domain.Exploration{}, domain.ErrInvalidInput
	}
	card, err := s.DailyCard(ctx, user, date)
	if err != nil {
		return card, err
	}
	if card.Body == "" {
		return card, fmt.Errorf("%w: 请先抽签，往日未抽签不可补抽", domain.ErrInvalidState)
	}
	return s.repo.SaveDailyCard(ctx, card, favorite, reflection)
}
