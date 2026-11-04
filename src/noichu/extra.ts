/**
 * Extra two-syllable words added to the Viet74K dictionary (dict/words.ts), written for this project (Apache-2.0,
 * like the rest of the repo; the GPL-2.0 list stays in dict/). Viet74K is a list of headwords, so it misses
 * everyday phrases such as "con mèo", "trà sữa", "ăn cơm" and many place names; these lists fill those gaps.
 *
 * Classifier + noun pairs are only listed where the pair is natural ("con" with animals, "quả" with fruit…),
 * so the expansion does not invent nonsense like "con bàn". Everything is lower case; `words.ts` merges and
 * de-duplicates it with the main list, and `test/noichu.test.ts` checks that every entry is a valid word.
 */

const list = (text: string) => text.split(",").map((w) => w.trim()).filter(Boolean);

/** classifier → nouns it goes with. */
const CLASSIFIED: Record<string, string> = {
  con: "mèo,chó,gà,vịt,ngan,ngỗng,trâu,bò,heo,lợn,dê,cừu,ngựa,voi,hổ,cọp,khỉ,vượn,gấu,sói,cáo,thỏ,chuột,sóc,nai,hươu,rùa,rắn,ếch,cóc,nhái,cá,tôm,cua,ghẹ,ốc,sò,hến,mực,chim,quạ,cò,sếu,nhạn,én,sẻ,công,trĩ,diều,cú,ong,kiến,muỗi,ruồi,gián,bướm,nhện,sâu,giun,dế,ve,vẹt,sáo,rệp,rết,chồn,bọ,đỉa,lươn,trạch,ba ba,cá chép",
  cái: "bàn,ghế,tủ,giường,nhà,cửa,bút,kéo,dao,thìa,đũa,bát,chén,đĩa,nồi,chảo,ấm,cốc,ly,bình,chai,lọ,gương,đèn,quạt,mũ,nón,áo,quần,túi,ví,kính,chuông,trống,kèn,đàn,thang,cầu,búa,cưa,kìm,xẻng,cuốc,gối,chăn,màn,rèm,bảng,thước,tẩy,cặp,hộp,thùng,rổ,rá,sọt,thúng,mẹt,chổi,xô,chậu,vòi,khay,bếp,lò,hố,ao,giếng,sân,vườn,cổng,tường,mái,cột,nhẫn,vòng,khăn,dây,kim,lược,gậy,còng,cân,xích,bẫy,lưới,chõng,sập,võng,phản,đệm",
  chiếc: "xe,thuyền,tàu,áo,quần,giày,dép,tất,vớ,mũ,nón,nhẫn,vòng,ô,dù,bút,bàn,ghế,giường,đèn,quạt,gương,lá,cầu,cặp,túi,ví,khăn,cốc,bát,đĩa,đũa,thìa,xuồng,bè,đò,phà,xe đạp,đồng hồ,hộp,thùng,bóng,cánh,răng,lược,gối,chăn,nôi,kèn,đàn,trống,loa,radio",
  quả: "cam,chanh,bưởi,xoài,dừa,na,mít,ổi,táo,lê,mận,đào,nho,dưa,bí,cà,ớt,chuối,trứng,bóng,đất,tim,thận,bom,mơ,vải,nhãn,lựu,khế,sung,me,dâu,cau,cọ,chôm chôm,đu đủ,hồng,thị,quýt,mãng cầu,roi,mướp,gấc,trám,sấu,bầu,khổ qua,đạn,tên lửa,cân,địa cầu",
  trái: "cam,chanh,bưởi,xoài,dừa,mít,ổi,táo,lê,mận,đào,nho,dưa,bí,cà,chuối,mơ,vải,nhãn,lựu,khế,sung,me,dâu,tim,đất,bóng,bom,hồng,quýt,thị,roi,mướp,gấc,sấu,bầu,đu đủ,mãng cầu,chôm chôm,cây",
  cây: "cam,chanh,bưởi,xoài,dừa,mít,ổi,tre,trúc,bàng,phượng,đa,si,liễu,thông,cau,cọ,lúa,ngô,mía,chuối,sắn,bút,cầu,cột,kem,kim,gậy,súng,đàn,nến,thước,sào,xăng,củi,cỏ,hoa,dừa,sấu,sung,me,gạo,sồi,bạch đàn,keo,cao su,cà phê,chè,tiêu,điều,đào,mai,quất,lựu,hồng,táo,lê,mận,dâu,nho,khế,đậu,bí,bầu,mướp,cà,ớt,rau,hành,tỏi,gừng,sả,nghệ,ngải,lau,sậy,cói,mây,tre",
  hoa: "hồng,lan,cúc,mai,đào,sen,súng,huệ,lài,nhài,sứ,phượng,bằng lăng,loa kèn,thược dược,đồng tiền,vạn thọ,lay ơn,dạ hương,ngọc lan,hải đường,mẫu đơn,păng xê,violet,tường vi,giấy,cẩm chướng,trà,bưởi,cau,xoan,gạo,sữa,mận,lê,táo,chanh,cam",
  bông: "hoa,hồng,cúc,sen,lúa,gòn,tuyết,mai,đào,huệ,lan,súng",
  con_nguoi: "trai,gái,dâu,rể,nuôi,cái,út,cả,trưởng,một,đẻ,ruột,mọn,thơ,nít,sen,ma,quỷ,tin,lăn,ranh,nhà,đường,mắt,ngươi,số,dấu,dao,sâu,tim,sông,suối,thuyền,nước,nợ,bạc,rối",
};

/** Plain lists (comma separated). */
const PLAIN = [
  // Provinces, cities, places
  "hà nội,sài gòn,đà nẵng,cần thơ,hải phòng,nghệ an,hà tĩnh,thanh hoá,thanh hóa,quảng bình,quảng trị,quảng nam,quảng ngãi,quảng ninh,bình định,phú yên,khánh hoà,khánh hòa,ninh thuận,bình thuận,kon tum,gia lai,đắk lắk,đắk nông,lâm đồng,bình phước,tây ninh,bình dương,đồng nai,long an,tiền giang,bến tre,vĩnh long,trà vinh,đồng tháp,an giang,kiên giang,hậu giang,sóc trăng,bạc liêu,cà mau,lào cai,yên bái,hà giang,cao bằng,bắc kạn,lạng sơn,thái nguyên,tuyên quang,phú thọ,vĩnh phúc,bắc giang,bắc ninh,hải dương,hưng yên,thái bình,hà nam,nam định,ninh bình,hoà bình,hòa bình,sơn la,điện biên,lai châu,vũng tàu,nha trang,đà lạt,hạ long,sa pa,hội an,phú quốc,côn đảo,sầm sơn,cửa lò,mũi né,phan thiết,quy nhơn,phan rang,tuy hoà,tuy hòa,đồng hới,đông hà,vinh,việt trì,thủ đức,biên hoà,biên hòa,mỹ tho,châu đốc,rạch giá,hà tiên,long xuyên,vị thanh,cao lãnh,sa đéc,bảo lộc,tam kỳ,huế",
  "việt nam,trung quốc,nhật bản,hàn quốc,thái lan,ấn độ,trung hoa,triều tiên,đài loan,hồng kông,ma cao,mã lai,miến điện,hà lan,thuỵ sĩ,thụy sĩ,thụy điển,thuỵ điển,na uy,đan mạch,phần lan,ba lan,hy lạp,ai cập,nam phi,bắc mỹ,nam mỹ,châu á,châu âu,châu phi,châu mỹ,châu úc,đông á,đông nam,tây nam,đông bắc,tây bắc,bắc bộ,trung bộ,nam bộ,tây nguyên,đồng bằng,miền bắc,miền trung,miền nam,miền núi,miền tây,hải ngoại,nước ngoài,trong nước",
  "sông hồng,sông hương,sông mã,sông cầu,sông đà,sông lô,sông gianh,sông hàn,sông tiền,sông hậu,mê kông,hồ gươm,hồ tây,đảo ngọc,núi non,núi rừng,biển đông,biển cả,thái bình,ấn độ",
  // Food and drink
  "trà sữa,phở bò,phở gà,phở cuốn,bún chả,bún bò,bún riêu,bún đậu,bún mắm,bún thang,bún ốc,bún cá,mì quảng,hủ tiếu,bánh cuốn,bánh xèo,bánh bao,bánh mì,bánh chưng,bánh tét,bánh dày,bánh rán,bánh bèo,bánh gai,bánh đa,bánh đúc,bánh giò,bánh nếp,bánh ngọt,bánh kẹo,bánh quy,cơm trắng,cơm rang,cơm tấm,cơm nếp,cơm chiên,cơm nhà,cơm canh,cơm hộp,cơm niêu,cơm lam,xôi gấc,xôi lạc,xôi đậu,xôi xéo,chè đậu,chè bưởi,chè thái,chè trôi,chè ba,chè chuối,canh chua,canh cua,canh rau,canh cá,canh bí,canh măng,canh cải,thịt gà,thịt bò,thịt heo,thịt lợn,thịt vịt,thịt dê,thịt chó,thịt kho,thịt luộc,thịt nướng,thịt rang,thịt băm,thịt viên",
  "cá kho,cá chiên,cá rán,cá nướng,cá hấp,cá chép,cá trê,cá rô,cá thu,cá basa,cá lóc,cá hồi,cá ngừ,cá mòi,cá khô,tôm rang,tôm hùm,tôm càng,tôm khô,cua biển,cua đồng,cua bể,ốc luộc,ốc nhồi,ốc bươu,nem rán,nem chua,nem nướng,giò chả,chả cá,chả giò,chả lụa,chả quế,nước mắm,nước chấm,nước ngọt,nước cam,nước chanh,nước dừa,nước mía,nước suối,nước lọc,nước sôi,nước trà,nước canh,nước dùng,nước hoa,trà đá,trà xanh,trà đào,trà chanh,trà nóng,trà lài,sữa tươi,sữa đậu,sữa bột,sữa chua,sinh tố,kem que,kem cây,kem ly,đậu hũ,đậu phụ,đậu xanh,đậu đen,đậu đỏ,đậu nành,đậu phộng,rau cải,rau muống,rau má,rau câu,rau thơm,rau sống,rau củ,hành lá,hành tây,hành tím,tỏi tây,củ cải,cà rốt,cà chua,cà tím,khoai lang,khoai tây,khoai mì,khoai môn,khoai sọ,ngô luộc,bắp rang,hạt dưa,hạt sen,mì gói,mì ý,mì tôm,mì xào,phô mai,trứng gà,trứng vịt,trứng cút,trứng rán,trứng luộc,đường phèn,đường cát,muối tiêu,muối ớt,bột ngọt,bột mì,bột gạo,mắm tôm,mắm tép,mắm cá,tương ớt,tương cà,dầu ăn,dầu ô,giấm ăn,gia vị,thực phẩm,đồ ăn,đồ uống,món ăn,món chính,món phụ,bữa cơm,bữa sáng,bữa trưa,bữa tối,ăn vặt,ăn uống",
  // Everyday verbs and phrases
  "ăn cơm,ăn sáng,ăn trưa,ăn tối,ăn tết,ăn uống,ăn mặc,ăn nói,ăn chơi,ăn ngủ,ăn chay,ăn mặn,uống nước,uống trà,uống thuốc,uống sữa,uống rượu,uống bia,đi học,đi làm,đi chơi,đi ngủ,đi bộ,đi chợ,đi xe,đi chùa,đi biển,đi tắm,đi lại,đi đứng,đi thi,đi lính,đi về,đi qua,chạy bộ,chạy xe,chạy nhảy,chạy đua,chạy trốn,nhảy múa,nhảy dây,nhảy cao,nhảy xa,hát hò,hát ca,ca hát,múa hát,học bài,học hành,học tập,học giỏi,học sinh,làm bài,làm việc,làm ăn,làm quen,làm lành,làm đẹp,làm nũng,làm duyên,làm bếp,làm vườn,làm ruộng,nói chuyện,nói dối,nói thật,nói đùa,nói nhỏ,nói to,nghe nhạc,nghe lời,nghe nói,xem phim,xem tivi,xem bóng,đọc sách,đọc báo,viết thư,viết bài,vẽ tranh,chơi game,chơi bóng,chơi cờ,chơi đàn,chơi nhạc,đá bóng,đá cầu,bơi lội,leo núi,tắm rửa,tắm biển,tắm gội,rửa bát,rửa mặt,rửa tay,quét nhà,lau nhà,giặt giũ,nấu cơm,nấu ăn,nấu nướng,mua bán,mua sắm,mua sách,bán hàng,gọi điện,nhắn tin,ngủ trưa,ngủ gật,ngủ say,thức dậy,thức khuya,dậy sớm,ngồi học,đứng dậy,nằm ngủ,cười nói,khóc lóc,vui chơi,vui vẻ,buồn bã,buồn chán,giận dữ,tức giận,sợ hãi,lo lắng,nhớ nhung,yêu thương,thương nhớ,thương yêu,mến thương,quý mến,kính trọng,tập thể,tập luyện,tập đi,tập bơi,tập đọc,tập viết,chăm sóc,chăm chỉ,chăm học,giúp đỡ,giúp việc,cho phép,cảm ơn,xin lỗi,xin chào,chào hỏi,tạm biệt,hẹn hò,hẹn gặp,gặp gỡ,gặp mặt,gặp nhau,chia sẻ,chia tay,chia buồn,chúc mừng,chúc tết,mừng tuổi,lì xì,sinh nhật,đám cưới,đám tang,đám giỗ",
  // Family
  "chú bác,cô dì,cô chú,cậu mợ,dì dượng,chú thím,bác gái,bác trai,anh trai,chị gái,em trai,em gái,ông nội,ông ngoại,bà nội,bà ngoại,cháu nội,cháu ngoại,con trai,con gái,con dâu,con rể,bố vợ,mẹ chồng,mẹ kế,bố dượng,anh rể,chị dâu,em rể,em dâu,họ hàng,thông gia,sui gia,cha ông,tổ tiên,ông bà,cha mẹ,bố mẹ,anh chị,anh em,chị em,vợ chồng,gia đình,con cái,cháu con,cháu chắt,hàng xóm,bạn bè,bạn thân,bạn học,bạn trai,bạn gái,thầy cô,thầy giáo,cô giáo,bác sĩ,y tá,công nhân,nông dân,kỹ sư,luật sư,ca sĩ,diễn viên,nhà báo,nhà văn,nhà thơ,học trò,sinh viên",
  // Modern and borrowed words
  "ti vi,sa lông,cà vạt,xi măng,bê tông,ô tô,xe hơi,xe đạp,xe máy,xe buýt,xe tải,xe lửa,xe ôm,tàu hoả,tàu hỏa,tàu thuỷ,tàu thủy,máy bay,máy tính,máy giặt,máy lạnh,máy ảnh,máy in,máy quay,điều hoà,điều hòa,tủ lạnh,nồi cơm,bếp gas,điện thoại,điện thoại,điện máy,điện tử,đồ chơi,đồ chơi,quần áo,giày dép,sách vở,bút chì,bút bi,cửa sổ,cửa hàng,cửa hiệu,tiền bạc,công việc,thời gian,cuộc sống,sức khoẻ,sức khỏe,thời tiết,mùa xuân,mùa hè,mùa thu,mùa đông,ngày mai,hôm nay,hôm qua,buổi sáng,buổi trưa,buổi chiều,buổi tối,ban đêm,ban ngày,năm mới,năm nay",
];

/** Every extra word, expanded and de-duplicated (order does not matter). */
export const EXTRA_WORDS: string[] = (() => {
  const out = new Set<string>();
  for (const [classifier, nouns] of Object.entries(CLASSIFIED)) {
    // `con_nguoi` holds "con + …" compounds for people and abstract things (con trai, con dâu…)
    const head = classifier === "con_nguoi" ? "con" : classifier;
    for (const noun of list(nouns)) out.add(`${head} ${noun}`);
  }
  for (const group of PLAIN) for (const w of list(group)) out.add(w);
  return [...out].map((w) => w.normalize("NFC").toLowerCase()).filter((w) => /^\p{L}+ \p{L}+$/u.test(w));
})();
