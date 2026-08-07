# Koç değerlendirmesi

## Niye var

Bu ana kadar koçu "bence daha iyi oldu" diye değiştirdik. Bu bir tahmindi. Bir istemi
değiştirdiğimizde neyi düzelttiğimizi ve **neyi bozduğumuzu** bilmiyorduk — bu işin en
klasik tuzağı da budur: bir davranışı düzeltirsin, üç tanesini sessizce kırarsın.

İlk koşuda üç gerçek ihlal çıktı; hiçbiri göz kararıyla fark edilmemişti:

- açılış mesajı **5 cümle** yazıyordu (istem "2-4" diyor)
- plan aşamasında **iki soru** birden soruyordu (istem "tek soru" diyor)
- istem enjeksiyonuna verdiği cevapta da aynı ikinci soru

Kuralı çıktı şemasına taşıyınca üçü de düzeldi ve tam küme koşusu başka bir şeyin
bozulmadığını gösterdi. Ölçüm olmadan bunların hiçbiri bilinemezdi.

## Kullanım

```bash
node eval/run.mjs                              # tüm vakalar
node eval/run.mjs mazeret plan                 # yalnızca bu id'ler
node eval/run.mjs --model=gemini-flash-latest  # başka modelle karşılaştır
```

Ayrıntılı çıktı `eval/son.json` içine yazılır (her vakanın tam cevabı ve denetim sonucu).

**Maliyet:** vaka başına bir koç çağrısı, tam küme ~₺4. Bir istem değişikliğini
körlemesine yayınlamaktan çok daha ucuz.

## İş akışı

1. İsteme ya da modele dokunmadan **önce** tam kümeyi koş, sonucu not al.
2. Değişikliği yap.
3. Önce düşen vakaları koş (ucuz), sonra **mutlaka tam kümeyi** koş.
4. Toplam denetim sayısı düştüyse bir şeyi bozmuşsundur — değişikliği geri al ya da düzelt.

**Tek seferde tek şey değiştir.** İki değişikliği birlikte yapıp puan düşerse hangisinin
suçlu olduğunu bilemezsin.

## Vaka eklemek

Gerçek bir sohbette koç kötü bir cevap verdiğinde, doğru refleks o durumu
`cases.mjs` içine vaka olarak eklemektir. Böylece:

- aynı hata bir daha sessizce geri gelemez
- küme zamanla kullanıcıların gerçekten yaşadığı durumlara benzer

Vaka bir `girdi` (koça giden veri) ve bir `bekle` (o durumda zorunlu olan davranışlar)
içerir. `bekle` içindeki her anahtarın karşılığı `checks.mjs` içindedir.

## Neyi ölçer, neyi ölçmez

**Ölçer** (deterministik, modelsiz, saniyeler): cümle sayısı, soru sayısı, aşamaya göre
eylem verilip verilmediği, eylem türünün beyaz listede olması, Türkçe konuşması, gerçek
veriye atıf yapması, notları aynen geri söylememesi, olmayan sayı uydurmaması, istem
sızdırmaması, dönen kullanıcıya kendini yeniden tanıtmaması.

**Ölçmez:** sıcaklık, ikna edicilik, tavsiyenin gerçekten isabetli olup olmadığı. Bunlar
için ya insan okuması ya da bir yargıç modeli gerekir. Deterministik denetimler önce
gelir çünkü istemde **açıkça söz verdiğimiz** şeyler bunlar — bir söz tutulmuyorken
öznel kaliteyi tartışmanın anlamı yok.
