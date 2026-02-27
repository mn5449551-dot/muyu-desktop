:::tip
Universal SSML是Flute统一TTS前端（Universal FrontEnd，简称UFE）采用的与具体语种解耦的SSML框架，能够方便地为不同语种提供SSML能力。
:::

注：

* 双向流式API目前不支持SSML
* ["豆包语音合成模型2.0"的音色](https://www.volcengine.com/docs/6561/1257544) 暂不支持SSML
* 豆包声音复刻模型2.0（icl 2.0）的音色暂不支持SSML

<span id="246bf37d"></span>
# 关于SSML
SSML是语音合成标记语言（Speech Synthesis Markup Language）的缩写。它是W3C的语音接口框架的一部分，通过SSML，可以对语音合成的效果进行定制化。
<span id="40ad6e36"></span>
## 关于Universal SSML
Universal SSML是Flute统一TTS前端（Universal FrontEnd，简称UFE）采用的与具体语种解耦的SSML框架，能够方便地为不同语种提供SSML能力。
:::tip
如果使用中英混音色，需要注意比较短的英文句子可能被语种识别为中文，部分标签在中文和英文场景下表现不同。例如在中文场景下，如果Verbatim内的文本是有效单词则不会按字母读。
:::
<span id="90fd00d2"></span>
# 必读
:::warning
* 接口传参时，请选择 text_type=ssml
* 所有文本 需放在 `<speak></speak>`标签之内
* 不同语种模型可使用的标签不同，请严格按照下表进行请求，否则会系统报错
* 当前仅支持中文普通话音色SSML调用，方言及小语种音色SSML调用后续会进行支持
* 使用ssml标签时合成字符不要超过150（包含标签本身），否则出现badcase概率会大大增加
:::
<span id="21b8b399"></span>
# 支持的标签

| | | | | \
|标签 |属性 |功能 |备注 |
|---|---|---|---|
| | | | | \
|\<speak\> | |根元素。 |\
| | |可设置全局属性。 |<speak>根元素是必需的。 |\
| | | |若无该元素，输入文本将不被认为是SSML |
|^^|^^|^^|^^| \
| | | | |
| | | | | \
|\<phoneme\> |alphabet="cmu" |指定单词发音的音标 |\
| | |（CMU格式） | |
|^^| | | | \
| |alphabet="py" |指定中文词的发音（拼音） | |
| | | | | \
|\<say-as\> |\
| |interpret-as |\
| | |指定解析文本的语义类型 |\
| | |（决定读法） |例如，20可以读作twenty，也可以读作two o |
| | | | | \
|\<sub\> |alias |文本替换 |等价于将其内部文本替换为alias属性中的文本 |
| | | | | \
|\<break\> |time |控制字词之间的停顿时长 |只支持time属性，strength 属性不支持 |

<span id="e89fc03e"></span>
## \<speak\> 根元素
<span id="e06abc30"></span>
### 描述
\<speak\>作为SSML的根元素出现。不存在该根元素的输入文本不会被认为是SSML。
<span id="57e0a82c"></span>
### 子元素
任意
<span id="efc3b489"></span>
### 注意事项

* 根元素即包含了其它全部内容的元素，不应存在与之并列或包含根元素的其它元素。
* 根元素应当只出现一次。

<span id="ff6fd044"></span>
### 实例
> 如无特别说明，实例中的音频均由英语UFE前端+DB6音色Tacotron后端生成。


* 正确示范

```XML
<speak>hello world</speak>
```



* 错误示范：多次出现<speak>

```XML
<speak>hello <speak>world</speak></speak>
```

> 报错：unrecognized ssml: 1 -- failed to parse child -- failed to parse ssml


* 错误示范：缺少唯一根元素（存在并列的顶级元素）

```XML
<speak>hello</speak> <speak>world</speak>
```

> 目前的行为是仅考虑第一个<speak>根元素的内容，暂不报错



* 错误示范：缺少<speak>根元素（不被认为是SSML）

```XML
hello world
```


```XML
hello <break/> world
```


<span id="1b8e35d1"></span>
## \<phoneme\> 指定字词发音（音素）
<span id="7c821f18"></span>
### 描述
\<phoneme\>用于手动指定部分字词的发音。通常用于纠正TTS为多音字自动生成的不准确发音。
<span id="15a4ca9b"></span>
### 属性

| | | | | \
|参数 |类型 |功能 |取值 |
|---|---|---|---|
| | | | | \
|`alphabet` |`enum` |指定表示发音（音素）的格式 |\
| | | |* 中文 |\
| | | |   * `py`拼音 |\
| | | |* 英文 |\
| | | |   * `cmu` CMU音标格式 |\
| | | |   * `ipa`柯林斯美音音标 |
| | | | | \
|`ph` |`string` |指定发音（音素） |* 不同的`alphabet`取值对应不同的`ph`表示方法 |\
| | | |   * 参见下文“注意事项”部分 |

<span id="ee449ca6"></span>
### 子元素
纯文本
<span id="4ea69185"></span>
### 拼音（`py`）
<span id="6ce4e7dc"></span>
#### 注意事项

* 用于中文前端。
* 使用空格分隔多个拼音。
* 不区分大小写。
* 子元素必须为纯文本，且为一个或多个汉字，不应出现标点符号。
* 声母是可选的。
* 音调包括：
   * 1 - 阴平、2 - 阳平、3 - 上声、4 - 去声
   * 5 - 轻声
   * 6 - 连续两个上声时，第一个上声的音调即为6（接近2 - 阳平），参见[三声变调（连上变调）](https://zh.wikipedia.org/zh-hans/%E8%AE%8A%E8%AA%BF)

<span id="86d906ff"></span>
#### 实例
```XML
<speak>《茜茜公主》是奥地利拍摄的历史题材的德语三部曲电影。</speak>
```


```XML
<speak> 《
    <phoneme alphabet="py" ph="xi1 xi1">茜茜</phoneme>
    公主》是奥地利拍摄的历史题材的德语三部曲电影。
</speak>
```


```XML
<speak>要一起去<phoneme alphabet="py" ph="chi1">吃</phoneme>饭吗</speak>
```


<span id="982285c2"></span>
### CMU音标（`cmu`）
<span id="3ec84584"></span>
#### 注意事项

* 用于英文前端。
* 使用空格分隔多个音素。
* 不区分大小写。
* CMU元音音标包含可选的Stress标号，如`IY1`、`UW2`。
* 子元素必须为纯文本，且为一个或多个英文单词，不应出现标点符号。

<span id="d80e9462"></span>
#### 实例

* 正确示范

```XML
<speak>
    <!-- 不区分大小写 -->
    <phoneme alphabet="cmu" ph="w uw1 ch IY1 l Uw n">
    Wu Qilong
    </phoneme> 
    and Wu Qilong
</speak>
```



* 错误示范：不应出现标点符号

```XML
 <speak>
    <phoneme alphabet="cmu" ph="w uw1 ch IY1 l Uw n">
    Wu, Qilong
    </phoneme> 
</speak>
```

> 报错：<phoneme> should align with the word groups

<span id="acf6d7bd"></span>
### 柯林斯美音音标（`ipa`）
<span id="e098432b"></span>
#### 注意事项

* 用于英文前端。
* 不使用分隔符，连续书写音标。
* 注意只能使用美式音标。
* 子元素必须为纯文本，且为一个或多个英文单词，不应出现标点符号。
* 音标包括：

```Python
"i",      "ɪ",     "ɛ/e",   "æ",      "ɑ/ɑː", "ɔ/ɔ:",      "u/u:",
"ʊ",      "ʌ",     "ə",     "ɜr/ɜːr", "ər",   "aɪ/ai",     "eɪ/ei",
"ɔɪ/ɔi",  "oʊ/ou", "aʊ/au", "ɑr/ɑːr", "ɔr",   "ʊr/ur/ʊər", "ɛr/ɛər",
"ɪr/ɪər", "p",     "b",     "t",      "d",    "k",         "g",
"f",      "v",     "θ",     "ð",      "s",    "z",         "ʃ",
"ʒ",      "tʃ",    "dʒ",    "tr",     "dr",   "ts",        "dz",
"l",      "r",     "m",     "n",      "ŋ",    "w",         "j",
"h",
```


* 重音符和次重音符：

```Python
"ˈ", "ˌ"
```

<span id="551bb97d"></span>
#### 实例

* 正确示范

```XML
<speak>
    <phoneme alphabet="ipa" ph="wutʃilun">
    Wu Qilong
    </phoneme>
    and Wu Qilong
</speak>
```


<span id="e531b2ed"></span>
## \<say-as\> 指定字词解析语义（读法）
<span id="f534bd28"></span>
### 描述
\<say-as\>用于指定解析文本的语义类型。同一文本内容可能有不同的解读，也就有不同的读法。
<span id="ea2713dc"></span>
### 属性

| | | | | \
|参数 |类型 |功能 |取值 |
|---|---|---|---|
| | | | | \
|`interpret-as` |\
| |`enum` |指定语义类型 |\
| | | |* 文本正规化支持的类别（取决于各语言前端的TextNorm模块的能力） |\
| | | |   * 英文 |\
| | | |      * `address` 地址 |\
| | | |      * `cardinal` 基数 |\
| | | |      * `date` 日期 |\
| | | |      * `decimal` 小数 |\
| | | |      * `digit` 数字序列 |\
| | | |      * `electronic`网络 |\
| | | |      * `fraction` 分数 |\
| | | |      * `letters`字母序列 |\
| | | |      * `letterss`字母序列复数 |\
| | | |      * `math` 数学 |\
| | | |      * `measure` 度量衡 |\
| | | |      * `money`金钱 |\
| | | |      * `ordinal` 序数 |\
| | | |      * `plain`缩写 |\
| | | |      * `score` 得分范围 |\
| | | |      * `telephone` 电话号码 |\
| | | |      * `time` 时间 |\
| | | |      * `verbatim` 逐字 |\
| | | |      * id: 适用于账户名、昵称等 |\
| | | |      * characters：将标签内的文本按字符一一读出。 |\
| | | |      * punctuation：将标签内的文本按标点符号的方式读出来。 |\
| | | |      * name：按人名发音。 |\
| | | |   * 中文 |\
| | | |      * `Cardinal`基数 |\
| | | |      * `Cardinal-Liang`基数（2 -> 两） |\
| | | |      * `Decimal`小数 |\
| | | |      * `Abbr`缩写 |\
| | | |      * `Spell`数字序列 |\
| | | |      * `Spell-Yao`数字序列（1 -> 幺） |\
| | | |      * `Time`时间 |\
| | | |      * `Time-Duration`时间段 |\
| | | |      * `Date-Y`日期-年 |\
| | | |      * `Date-M`日期-月 |\
| | | |      * `Date-D`日期-日 |\
| | | |      * `Date-YMD`日期-年月（日） |\
| | | |      * `Date-MDY`日期-月日（年） |\
| | | |      * `Date-DMY`日期-日月（年） |\
| | | |      * `Percent`百分数 |\
| | | |      * `Fraction`分数 |\
| | | |      * `Score`比分 |\
| | | |      * `Currency`金钱 |\
| | | |      * `Electronic`网络 |\
| | | |      * `Measure`度量衡 |\
| | | |      * `Telephone`电话 |\
| | | |      * `Ordinal`序数 |\
| | | |      * `Math`数学 |\
| | | |      * `Range`范围 |\
| | | |      * `Letters`字母序列 |\
| | | |      * `Letterss`字母序列复数 |\
| | | |      * `Verbatim`逐字 |\
| | | |      * id: 适用于账户名、昵称等 |\
| | | |      * characters：将标签内的文本按字符一一读出。 |\
| | | |      * punctuation：将标签内的文本按标点符号的方式读出来。 |\
| | | |      * name：按人名发音。 |

<span id="ff4da1a1"></span>
### 子元素
纯文本
<span id="f050e4d3"></span>
### 文本正规化支持的类别
<span id="0db974de"></span>
#### 注意事项

* 不区分大小写。
* 子元素必须为纯文本。

<span id="ea57cdaa"></span>
### 各<say-as>类型支持范围
<span id="2007fad5"></span>
#### id

| | | | | \
|**格式** |**示例** |**输出** |**说明** |
|---|---|---|---|
| | | | | \
|字符串 |dell0101 |D E L L 零 一 零 一 |大小写英文字符、阿拉伯数字0~9、下划线。 |\
| | | |输出的空格表示每个字符之间插入停顿，即字符一个一个地读。 |
|^^| | |^^| \
| |myid_1998 |M Y I D 下划线 一 九 九 八 | |
|^^| | |^^| \
| |AiTest |A I T E S T | |


* 英文文本该标签功能同标签characters。
* 只支持中英两种语种，暂不支持其他小语种
* 纯英文场景下，请求参数中需要指定"req_params.additions.explicit_language=en"，否则有可能会默认识别为中文。
* 样例

```XML
<speak>
  <say-as interpret-as="id">myid_1998</say-as>
</speak>
```

<span id="de2b38db"></span>
#### characters

| | | | | \
|**格式** |**示例** |**中文输出** |**说明** |
|---|---|---|---|
| | | | | \
|字符串 |ISBN 1-001-099098-1 |I S B N 一 杠 零 零 一 杠 零 九 九 零 九 八 杠 一 |支持中文汉字、大小写英文字符、阿拉伯数字0~9以及部分全角和半角字符。 |\
| | | |输出的空格表示每个字符之间插入停顿，即字符一个一个地读。标签内的文本如果包含XML的特殊字符，需要做字符转义。 |
|^^| | |^^| \
| |x10b2345_u |x 一 零 b 二 三 四 五 下划线 u | |
|^^| | |^^| \
| |v1.0.1 |v 一 点 零 点 一 | |
|^^| | |^^| \
| |版本号2.0 |版本号二 点 零 | |
|^^| | |^^| \
| |苏M MA000 |苏M M A 零 零 零 | |
|^^| | |^^| \
| |空中客车A330 |空中客车A 三 三 零 | |
|^^| | |^^| \
| |型号s01 s02和s03 |型号s 零 一 s 零二 和s 零 三 | |
|^^| | |^^| \
| |空中客车A330 |空中客车A 三 三 零 | |
|^^| | |^^| \
| |αβγ |阿尔法 贝塔 伽玛 | |


* 只支持中英两种语种，暂不支持其他小语种
* 纯英文场景下，请求参数中需要指定"req_params.additions.explicit_language=en"，否则有可能会默认识别为中文。
* 样例

```XML
<speak>
  <say-as interpret-as="characters">希腊字母αβ</say-as>
</speak>
```


<span id="96db7fb0"></span>
#### punctuation

| | | | | \
|**格式** |**示例** |**中文输出** |**说明** |
|---|---|---|---|
| | | | | \
|标点符号 |… |省略号 |支持常见中英文标点。输出的空格表示每个字符之间插入停顿，即字符一个一个地读。 |\
| | | |标签内的文本如果包含XML的特殊字符，需要做字符转义。 |
|^^| | |^^| \
| |…… |省略号 | |
|^^| | |^^| \
| |!"#$%& |叹号 双引号 井号 dollar 百分号 and | |
|^^| | |^^| \
| |‘()*+ |单引号 左括号 右括号 星号 加号 | |
|^^| | |^^| \
| |,-./:; |逗号 杠 点 斜杠 冒号 分号 | |
|^^| | |^^| \
| |<=>?@ |小于 等号 大于 问号 at | |


* 英文文本该标签功能同标签characters。
* 只支持中英两种语种，暂不支持其他小语种
* 纯英文场景下，请求参数中需要指定"req_params.additions.explicit_language=en"，否则有可能会默认识别为中文。
* 样例

```XML
<speak>
    测试<say-as interpret-as="punctuation"> -./:;</say-as>
</speak>
```


<span id="7b6e7b56"></span>
#### name

* 作用于多音字的姓；(若需要全名均生效，可以直接使用phoneme属性)
* 仅适用于中文场景
* 样例

```XML
<speak>
  她的曾用名是<say-as interpret-as="name">曾小凡</say-as>
</speak>
```

<Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/83993971bbd64eba9d07cf44bab5000a~tplv-goo7wpa0wc-image.image" name="SSML_say-as_name.wav" ></Attachment>
<span id="a3ac2921"></span>
### 实例

* 正确示范

```XML
<speak>12:30 and <say-as interpret-as="score">12:30</say-as></speak>
```


```XML
<speak>12.30 and <say-as interpret-as="date">12.30</say-as></speak>
```


```XML
<speak>
    20 
    and <say-as interpret-as="ordinal">20</say-as> 
    and <say-as interpret-as="digit">20</say-as>
</speak>
```


```XML
<speak>hello and <say-as interpret-as="verbatim">hello</say-as></speak>
```



* 错误示范：不应出现其它标签

```XML
<speak>
    <say-as interpret-as="digit">
        12 <break time="100ms" /> 34
    </say-as>
</speak>
```

> 报错：<say-as> can only contain plain text -- failed to parse child -- failed to parse ssml

<span id="4e89b13b"></span>
## \<sub\> 文本替换
<span id="44c55dbb"></span>
### 描述
\<sub\>等价于将其内部的文本替换为其alias属性中的文本。
<span id="14757b01"></span>
### 属性

| | | | | \
|参数 |类型 |功能 |取值 |
|---|---|---|---|
| | | | | \
|`alias` |`string` |替换文本 | |

<span id="31f74f88"></span>
### 实例
```XML
<speak><sub alias="语音合成标记语言">SSML</sub></speak>
```


<span id="ba9d8635"></span>
## \<break\> 停顿
<span id="a8120388"></span>
### 描述
用于在文本中插入停顿，该标签是可选标签。
<span id="9b9bfd5c"></span>
### 语法
```Plain Text
# 空属性，停顿时长默认为1s
<break/>
# time属性
<break time="string"/>
```

<span id="9d8914af"></span>
#### 注意事项

* 该标签只适用于[豆包语音合成模型1.0"的音色](https://www.volcengine.com/docs/6561/1257544)，不适用于[豆包语音合成模型2.0"的音色](https://www.volcengine.com/docs/6561/1257544)
* 空属性，停顿时长默认为1s

```XML
<speak>测试<break/>停顿</speak
```


* 连续出现多个<break> 标签时，停顿时长为各个标签停顿时长之和，若总时长超过10秒，则只生成10秒的停顿。

比如以下示例: 累加时长超过10秒，则只生成10秒的停顿
```XML
<speak>测试<break time="5s"/><break time="5s"/><break time="5s"/>停顿</speak>
```


* break务必要有闭合标签

比如以下均为**错误写法**
```XML
<speak>测试<break>停顿</speak>
<speak>测试<break time="1s">停顿</speak>
```

<span id="88e8fdf2"></span>
### 属性
<span id="deef7fce"></span>
### 
| | | | | \
|参数 |类型 |属性值 |描述 |
|---|---|---|---|
| | | | | \
|time |string |[number]s  |\
| | |或者 |\
| | |[number]ms |以秒/毫秒为单位设置停顿时长（如“1s”, "10ms"） |\
| | | | |\
| | | |* [number]s: 以秒为单位，number 取值范围为[1, 10]的整数 |\
| | | |* [number]ms: 以毫秒为单位，number 取值范围为[1, 10000]的整数 |

<span id="d341e791"></span>
### 实例

* 停顿1秒

```XML
<speak>测试<break time="1s"/>停顿</speak>
```


* 停顿10毫秒

```XML
<speak>测试<break time="10ms"/>停顿</speak>
```

<span id="21bf16d3"></span>
# \<say-as>常见符号读法如下表所示

| | | | \
|**符号** |**中文读法** |**英文读法** |
|---|---|---|
| | | | \
|! |叹号 |exclamation mark |
| | | | \
|“ |双引号 |double quote |
| | | | \
|\# |井号 |pound |
| | | | \
|$ |dollar |dollar |
| | | | \
|% |百分号 |percent |
| | | | \
|& |and |and |
| | | | \
|‘ |单引号 |left quote |
| | | | \
|( |左括号 |left parenthesis |
| | | | \
|） |右括号 |right parenthesis |
| | | | \
|\* |星 |asterisk |
| | | | \
|\+ |加 |plus |
| | | | \
|, |逗号 |comma |
| | | | \
|\- |杠 |dash |
| | | | \
|. |点 |dot |
| | | | \
|/ |斜杠 |slash |
| | | | \
|： |零冒号 |solon |
| | | | \
|； |分号 |semicolon |
| | | | \
|< |小于 |less than |
| | | | \
|= |等号 |equals |
| | | | \
|\> |大于 |greater than |
| | | | \
|? |问号 |question mark |
| | | | \
|@ |at |at |
| | | | \
|[ |左方括号 |left bracket |
| | | | \
|\ |反斜线 |back slash |
| | | | \
|] |右方括号 |right bracket |
| | | | \
|^ |脱字符 |caret |
| | | | \
|_ |下划线 |underscore |
| | | | \
|\` |反引号 |back quote |
| | | | \
|{ |左花括号 |left brace |
| | | | \
|\| |竖线 |vertical bar |
| | | | \
|} |右花括号 |right brace |
| | | | \
|~ |波浪线 |tilde |
| | | | \
|！ |叹号 |exclamation mark |
| | | | \
|“ |左双引号 |left double quote |
| | | | \
|” |右双引号 |right double qute |
| | | | \
|‘ |左单引号 |left quote |
| | | | \
|’ |右单引号 |right quote |
| | | | \
|（ |左括号 |left parenthesis |
| | | | \
|） |右括号 |right parenthesis |
| | | | \
|， |逗号 |comma |
| | | | \
|。 |句号 |full stop |
| | | | \
|— |杠 |em dash |
| | | | \
|： |冒号 |colon |
| | | | \
|； |分号 |semicolon |
| | | | \
|？ |问号 |question mark |
| | | | \
|、 |顿号 |enumeration comma |
| | | | \
|… |省略号 |ellipsis |
| | | | \
|…… |省略号 |ellipsis |
| | | | \
|《 |左书名号 |left guillemet |
| | | | \
|》 |右书名号 |right guillemet |
| | | | \
|￥ |人民币符号 |yuan |
| | | | \
|≥ |大于等于 |greater than or equal to |
| | | | \
|≤ |小于等于 |less than or equal to |
| | | | \
|≠ |不等于 |not equal |
| | | | \
|≈ |约等于 |approximately equal |
| | | | \
|± |加减 |plus or minus |
| | | | \
|× |乘 |times |
| | | | \
|π |派 |pi |
| | | | \
|Α |阿尔法 |alpha |
| | | | \
|Β |贝塔 |beta |
| | | | \
|Γ |伽玛 |gamma |
| | | | \
|Δ |德尔塔 |delta |
| | | | \
|Ε |艾普西龙 |epsilon |
| | | | \
|Ζ |捷塔 |zeta |
| | | | \
|Θ |西塔 |theta |
| | | | \
|Ι |艾欧塔 |iota |
| | | | \
|Κ |喀帕 |kappa |
| | | | \
|∧ |拉姆达 |lambda |
| | | | \
|Μ |缪 |mu |
| | | | \
|Ν |拗 |nu |
| | | | \
|Ξ |克西 |ksi |
| | | | \
|Ο |欧麦克轮 |omicron |
| | | | \
|∏ |派 |pi |
| | | | \
|Ρ |柔 |rho |
| | | | \
|∑ |西格玛 |sigma |
| | | | \
|Τ |套 |tau |
| | | | \
|Υ |宇普西龙 |upsilon |
| | | | \
|Φ |fai |phi |
| | | | \
|Χ |器 |chi |
| | | | \
|Ψ |普赛 |psi |
| | | | \
|Ω |欧米伽 |omega |
| | | | \
|α |阿尔法 |alpha |
| | | | \
|β |贝塔 |beta |
| | | | \
|γ |伽玛 |gamma |
| | | | \
|δ |德尔塔 |delta |
| | | | \
|ε |艾普西龙 |epsilon |
| | | | \
|ζ |捷塔 |zeta |
| | | | \
|η |依塔 |eta |
| | | | \
|θ |西塔 |theta |
| | | | \
|ι |艾欧塔 |iota |
| | | | \
|κ |喀帕 |kappa |
| | | | \
|λ |拉姆达 |lambda |
| | | | \
|μ |缪 |mu |
| | | | \
|ν |拗 |nu |
| | | | \
|ξ |克西 |ksi |
| | | | \
|ο |欧麦克轮 |omicron |
| | | | \
|π |派 |pi |
| | | | \
|ρ |柔 |rho |
| | | | \
|σ |西格玛 |sigma |
| | | | \
|τ |套 |tau |
| | | | \
|υ |宇普西龙 |upsilon |
| | | | \
|φ |fai |phi |
| | | | \
|χ |器 |chi |
| | | | \
|ψ |普赛 |psi |
| | | | \
|ω |欧米伽 |omega |


